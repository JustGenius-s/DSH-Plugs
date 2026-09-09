/**
 * Side-chat model picker state, as plain functions.
 *
 * The picker must never become a dead end: a disabled trigger cannot be
 * opened, so any explanation placed inside the menu is unreachable — which is
 * exactly how "cannot pick a model" was reported: the control sat there inert
 * while the reason (loading vs. failed lookup vs. empty directory vs. provider
 * failures) stayed invisible. Everything below answers one question — what
 * should the open menu show — so the composer only renders it.
 */

import type { SessionModels } from './types'

/** The model directory the picker is currently working from. */
export type ModelDirectoryState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; value: SessionModels }

/**
 * What the open model menu renders, resolved from the directory state.
 *
 * `notice` is set for every state that cannot offer a model list; the trigger
 * itself stays enabled regardless, because the notice is the point.
 */
export interface ModelMenuNotice {
  /** Loading / failure / empty-directory line, or none when models are listed. */
  text?: string
  /** Provider failure causes, when the directory is empty because of them. */
  details?: readonly string[]
}

/** Resolve the notice the open menu should show above any model list. */
export function modelMenuNotice(state: ModelDirectoryState): ModelMenuNotice {
  if (state.status === 'loading') return { text: '正在加载模型目录…' }
  if (state.status === 'error') return { text: state.message || '模型目录加载失败' }
  const groups = state.value?.groups ?? []
  if (groups.length > 0) return {}
  const failures = state.value?.failures ?? []
  return {
    text: '没有可用的模型目录',
    details: failures.map(failure =>
      `${failure.name ?? failure.id}: ${failure.message ?? 'provider 失败'}`),
  }
}

/**
 * The label the trigger shows before any model is picked.
 *
 * Loading keeps its own short form so the trigger width stays stable while
 * the directory arrives.
 */
export function modelTriggerLabel(state: ModelDirectoryState, selected: string | undefined): string {
  if (selected !== undefined && selected.length > 0) return selected
  if (state.status === 'loading') return '模型…'
  return '选择模型'
}

/**
 * Classify a model-directory lookup failure into a user-facing message.
 *
 * A carrier TypeError here is almost always the `remote.session` namespace not
 * being mounted (the plugin's browser inject list lacks `dsh-api-remotes`);
 * naming it tells the user what to fix instead of a bare "lookup failed".
 */
export function modelLookupErrorMessage(cause: unknown): string {
  if (cause instanceof TypeError) {
    return 'remote.session 未挂载，无法读取模型目录（检查 dsh.client.inject 是否包含 @deepseek-ai/dsh-api-remotes）'
  }
  if (cause instanceof Error && cause.message.length > 0) return cause.message
  return 'model lookup failed'
}
