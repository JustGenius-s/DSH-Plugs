/**
 * The side-chat model directory, read through `ctx.modelDirectories`.
 *
 * DSH 0.1.2 REMOVED the envelope RPC this used to go through
 * (`connection.api.sessions.models` / `.selectModel`). The picker read that
 * namespace for a whole release after the removal: the inject entry is still
 * present and the api object still exists, so nothing threw and nothing
 * logged — the directory simply never arrived, and the picker reported
 * "connection.api 不可用", which pointed at a missing inject rather than at
 * the RPC that no longer exists.
 *
 * The 0.1.2 owner of per-session model selection is the `modelDirectories`
 * service (`ModelDirectoryResolver`, registered by
 * `@deepseek-ai/dsh-client-ui-model-selection`): one shared directory per
 * session, combining the Host-generation catalog with the session's durable
 * selection. Its state shape is what the picker already renders, so this
 * module only adapts the call — the picker's pure functions are untouched.
 *
 * Pure and injectable: every function takes the service as a value, so the
 * resolution, the load, and the selection are testable without a client ctx.
 */

import type { ModelSelection, SessionModels } from './types'

/** The slice of `ctx.modelDirectories` this module uses. */
export interface ModelDirectoryResolverFace {
  directoryFor(sessionId: never): ModelDirectoryFace
}

/** One session's directory: the load + select verbs the picker needs. */
export interface ModelDirectoryFace {
  load(): Promise<ModelDirectorySnapshot>
  select(selection: ModelSelection): Promise<void>
}

/** The directory state the host returns (superset of what the picker renders). */
export interface ModelDirectorySnapshot {
  current?: ModelSelection | null
  groups?: readonly { id: string; name?: string; models: readonly unknown[] }[]
  failures?: readonly { id: string; name?: string; message?: string }[]
  status?: string
  error?: string | null
}

/**
 * Resolve the service off a Cordis context.
 *
 * `ctx.get` never throws for an undeclared service, so it is tried first; the
 * property read is the fallback for contexts that expose the service directly.
 * Both are guarded because Cordis's proxy throws
 * `cannot get property ... without inject` for a name that is not declared.
 *
 * @returns the resolver, or undefined when the service is not composed.
 */
export function modelDirectoriesOf(ctx: object): ModelDirectoryResolverFace | undefined {
  try {
    const getter = (ctx as { get?: unknown }).get
    if (typeof getter === 'function') {
      const service = (getter as (name: string) => unknown).call(ctx, 'modelDirectories')
      if (service !== undefined && typeof (service as ModelDirectoryResolverFace).directoryFor === 'function') {
        return service as ModelDirectoryResolverFace
      }
    }
  } catch {
    // An undeclared/unguarded service: fall through to the property read.
  }
  try {
    const service = (ctx as { modelDirectories?: ModelDirectoryResolverFace }).modelDirectories
    if (service !== undefined && typeof service.directoryFor === 'function') return service
  } catch {
    // A throwing proxy: the service is simply not there.
  }
  return undefined
}

/** The message shown when the service itself is missing. */
export const MODEL_DIRECTORY_MISSING_MESSAGE =
  'ctx.modelDirectories 不可用，无法读取模型目录（检查 dsh.client.inject 是否包含 @deepseek-ai/dsh-client-ui-model-selection）'

/**
 * Load one session's model directory.
 *
 * A missing service, a rejected load, and a per-provider failure are three
 * different stories and are kept apart: the picker explains an empty list
 * with the provider causes, so a refused provider must not be flattened into
 * a generic "lookup failed" — that is the message that pointed at the wrong
 * fix for a whole release.
 *
 * @returns the picker's directory state.
 */
export async function loadModelDirectory(
  service: ModelDirectoryResolverFace | undefined,
  sessionId: string,
): Promise<SessionModels> {
  if (service === undefined) throw new Error(MODEL_DIRECTORY_MISSING_MESSAGE)
  const directory = service.directoryFor(sessionId as never)
  const state = await directory.load()
  const groups = (state.groups ?? []).map(group => ({
    id: group.id,
    ...(group.name === undefined ? {} : { name: group.name }),
    models: group.models,
  }))
  const failures = (state.failures ?? []).map(failure => ({
    id: failure.id,
    ...(failure.name === undefined ? {} : { name: failure.name }),
    ...(failure.message === undefined ? {} : { message: failure.message }),
  }))
  const current = state.current ?? null
  return {
    ...(current === null ? {} : { current }),
    groups: groups as SessionModels['groups'],
    ...(failures.length === 0 ? {} : { failures }),
  }
}

/**
 * Select a provider/model/effort for one session.
 *
 * @throws the cause, so the caller's own error surface reports it.
 */
export async function selectModel(
  service: ModelDirectoryResolverFace | undefined,
  sessionId: string,
  selection: ModelSelection,
): Promise<void> {
  if (service === undefined) throw new Error(MODEL_DIRECTORY_MISSING_MESSAGE)
  await service.directoryFor(sessionId as never).select(selection)
}
