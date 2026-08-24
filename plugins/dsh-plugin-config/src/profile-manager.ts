import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
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

  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const run = chain.then(operation, operation)
    chain = run.then(() => undefined, () => undefined)
    return run
  }

  const runMutation = async (args: readonly string[]): Promise<string> => {
    const result = await runDsh(['plugin', '--profile', 'web', ...args], MUTATION_TIMEOUT_MS)
    const detail = commandDetail(result)
    if (result.code !== 0) throw new Error(detail || `dsh ${args.join(' ')} exited ${result.code}`)
    return detail
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
          needsRestart: patchChanged || added.length > 0 || removed.length > 0,
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
