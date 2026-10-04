import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import { repairWebProfileScopeIdentity } from '@just-genius/dsh-plugin-runtime/host'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  PluginProfileApplyResult,
  PluginProfileManager,
  PluginProfileSnapshot,
} from '@just-genius/dsh-plugin-runtime'
import {
  profileModifiedAt,
  readPatchText,
  readProfilePackage,
  removeDisablePatch,
  writeDisablePatch,
  writePatchText,
} from './profile.ts'
import { commandDetail, runDsh } from './process.ts'

const MUTATION_TIMEOUT_MS = 180_000
const OUTDATED_TIMEOUT_MS = 120_000

export function createPluginProfileManager(ctx: Context): PluginProfileManager {
  let chain = Promise.resolve()
  let scopeNeedsRestart = false

  const repairScope = (): void => {
    const backup = repairWebProfileScopeIdentity(process.env.DSH_HOME || join(homedir(), '.dsh'))
    if (backup !== undefined) {
      scopeNeedsRestart = true
      ctx.logger.warn(`Repaired duplicate dsh-scope; restart DSH to load the shared Host scope. Backup: ${backup}`)
    }
  }
  // Also recover profiles installed outside this manager. Loaded module caches
  // still require a Host restart; never pretend a disk repair changes them.
  try { repairScope() } catch (error) { ctx.logger.warn(`Profile scope check failed: ${String(error)}`) }

  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const run = chain.then(operation, operation)
    chain = run.then(() => undefined, () => undefined)
    return run
  }

  const runMutation = async (args: readonly string[]): Promise<string> => {
    const outcome = await runDsh(['plugin', '--profile', 'web', ...args], MUTATION_TIMEOUT_MS).then(
      (result) => {
        const detail = commandDetail(result)
        return {
          detail,
          error: result.code === 0 ? undefined : new Error(detail || `dsh ${args.join(' ')} exited ${result.code}`),
        }
      },
      (error: unknown) => ({
        detail: '',
        error: error instanceof Error ? error : new Error(String(error)),
      }),
    )
    // Failed/timed-out package operations can also have rewritten node_modules.
    try {
      repairScope()
    } catch (error) {
      throw new Error([outcome.error?.message, `Profile scope check failed: ${String(error)}`].filter(Boolean).join('\n'))
    }
    if (outcome.error !== undefined) throw outcome.error
    return outcome.detail
  }

  const manager: PluginProfileManager = {
    snapshot(): PluginProfileSnapshot {
      return {
        dependencies: { ...(readProfilePackage().dependencies ?? {}) },
        patchText: readPatchText(),
        modifiedAt: profileModifiedAt(),
      }
    },

    reconcile(input): Promise<PluginProfileApplyResult> {
      return serialize(async () => {
        if (input.expectedModifiedAt !== undefined) {
          const currentModifiedAt = profileModifiedAt()
          if (currentModifiedAt !== input.expectedModifiedAt) {
            throw new Error('profile changed since it was loaded')
          }
        }
        const current = readProfilePackage().dependencies ?? {}
        const desired = input.dependencies
        const remove = Object.keys(current).filter(name => !(name in desired))
        const add = Object.entries(desired).filter(([name, spec]) => current[name] !== spec)
        const added: string[] = []
        const removed: string[] = []
        const failed: Array<{ name: string; error: string }> = []

        for (const name of remove) {
          try {
            await runMutation(['remove', name])
            removed.push(name)
          } catch (error) {
            failed.push({ name, error: error instanceof Error ? error.message : String(error) })
          }
        }
        for (const [name, spec] of add) {
          try {
            await runMutation(['add', installTarget(name, spec)])
            added.push(name)
          } catch (error) {
            failed.push({ name, error: error instanceof Error ? error.message : String(error) })
          }
        }

        const nextPatch = input.patchText === '' || input.patchText.endsWith('\n')
          ? input.patchText
          : `${input.patchText}\n`
        const patchChanged = readPatchText() !== nextPatch
        if (patchChanged) writePatchText(nextPatch)
        return {
          added,
          removed,
          failed,
          patchChanged,
          needsRestart: scopeNeedsRestart || patchChanged || added.length > 0 || removed.length > 0,
        }
      })
    },

    install(spec) {
      return serialize(async () => ({ detail: await runMutation(['add', spec]), needsRestart: true }))
    },

    remove(packageName) {
      return serialize(async () => ({ detail: await runMutation(['remove', packageName]), needsRestart: true }))
    },

    update(packageName) {
      return serialize(async () => ({
        detail: await runMutation(['update', packageName, '--latest']),
        needsRestart: true,
      }))
    },

    outdated(packageNames) {
      return serialize(async () => {
        const result = await runDsh(
          ['plugin', '--profile', 'web', 'outdated', ...packageNames, '--format', 'json'],
          OUTDATED_TIMEOUT_MS,
        )
        const raw = result.stdout.trim()
        if (result.code !== 0 && result.code !== 1) {
          throw new Error(result.stderr.trim() || `dsh plugin outdated exited ${result.code}`)
        }
        try {
          return raw === '' ? {} : JSON.parse(raw)
        } catch {
          throw new Error('Could not parse pnpm outdated JSON.')
        }
      })
    },

    setDisabled(localId, entryId, disabled) {
      return serialize(async () => {
        writeDisablePatch(localId, disabled)
        try {
          await ctx.loader.update(entryId, { disabled })
          return { live: true }
        } catch {
          return { live: false }
        }
      })
    },

    removeDisable(localId) {
      removeDisablePatch(localId)
    },
  }

  return manager
}

function installTarget(name: string, spec: string): string {
  if (
    spec.startsWith('github:')
    || spec.startsWith('git+')
    || spec.startsWith('git@')
    || spec.startsWith('http://')
    || spec.startsWith('https://')
    || spec.startsWith('file:')
    || spec.startsWith('link:')
    || spec.startsWith('/')
  ) return spec
  if (spec.startsWith('npm:')) return `${name}@${spec}`
  return `${name}@${spec}`
}
