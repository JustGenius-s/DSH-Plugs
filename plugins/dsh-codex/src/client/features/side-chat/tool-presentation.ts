/**
 * Tool presentation for the side-chat transcript.
 *
 * Maps a DSH tool name onto the collapsed row a transcript renders: which
 * icon variant it is, the label shown when the call carries nothing more
 * specific, and which argument keys make the best one-line summary.
 *
 * Recovered from its call sites in `transcript.tsx` — the original file was
 * destroyed with the uncommitted tree, but every export it offered is used
 * there, so the interface below is exactly what the transcript reads.
 */

/** Icon/colour family one tool call collapses into. */
export type ToolVariant =
  | 'search'
  | 'read'
  | 'write'
  | 'edit'
  | 'bash'
  | 'code'
  | 'todo'
  | 'job'
  | 'web'
  | 'agent'
  | 'skill'
  | 'question'
  | 'image'
  | 'other'

/** Lifecycle state of one tool call row. */
export type ToolState = 'running' | 'ok' | 'error' | 'stopped'

/** The presentation one tool name resolves to. */
export interface ToolPresentation {
  variant: ToolVariant
  /** Title line; empty when the variant label alone reads better. */
  title: string
  /** Argument keys, best first, for the one-line summary. */
  summaryKeys: readonly string[]
}

interface ToolCallViewShape {
  title?: unknown
  terminal?: unknown
}

/**
 * Resolve one tool call's presentation.
 *
 * `view` is the call's structured view; a `title` on it wins over the
 * name-derived one, and a terminal flag on it marks a command the row can
 * render through the terminal block.
 */
export function toolPresentation(
  name: string,
  view?: ToolCallViewShape | null,
): ToolPresentation {
  const spec = SPECS[name] ?? SPEC_OTHER
  const viewTitle = typeof view?.title === 'string' ? view.title.trim() : ''
  return {
    variant: spec.variant,
    title: viewTitle.length > 0 ? viewTitle : '',
    summaryKeys: spec.summaryKeys,
  }
}

/** The label for a variant when no call-specific title exists. */
export function variantTitle(variant: ToolVariant): string {
  return VARIANT_TITLES[variant] ?? VARIANT_TITLES.other
}

/** Whether a row should render through the terminal block. */
export function isTerminalCall(
  variant: ToolVariant,
  view?: ToolCallViewShape | null,
): boolean {
  if (view?.terminal === true) return true
  return variant === 'bash'
}

/** Name → variant + summary keys. Unknown names fall back to `other`. */
const SPECS: Readonly<Record<string, { variant: ToolVariant; summaryKeys: readonly string[] }>> = {
  bash: { variant: 'bash', summaryKeys: ['command', 'cmd'] },
  web_search: { variant: 'search', summaryKeys: ['query', 'keywords'] },
  search: { variant: 'search', summaryKeys: ['query', 'q'] },
  read: { variant: 'read', summaryKeys: ['path', 'file_path'] },
  view_image: { variant: 'image', summaryKeys: ['path', 'file_path', 'url'] },
  write: { variant: 'write', summaryKeys: ['path', 'file_path'] },
  edit: { variant: 'edit', summaryKeys: ['path', 'file_path'] },
  todo_write: { variant: 'todo', summaryKeys: ['todos'] },
  todo: { variant: 'todo', summaryKeys: ['todos'] },
  job: { variant: 'job', summaryKeys: ['jobId', 'id', 'title'] },
  web_fetch: { variant: 'web', summaryKeys: ['url'] },
  ask_user_question: { variant: 'question', summaryKeys: ['questions'] },
  skill: { variant: 'skill', summaryKeys: ['skill', 'name'] },
  workflow: { variant: 'code', summaryKeys: ['name', 'meta'] },
  ralph: { variant: 'agent', summaryKeys: ['objective'] },
  subagent: { variant: 'agent', summaryKeys: ['description', 'prompt'] },
  create_goal: { variant: 'other', summaryKeys: ['objective'] },
  memory_propose: { variant: 'other', summaryKeys: ['title'] },
}

const SPEC_OTHER: { variant: ToolVariant; summaryKeys: readonly string[] } = {
  variant: 'other',
  summaryKeys: ['path', 'file_path', 'url', 'name'],
}

const VARIANT_TITLES: Readonly<Record<ToolVariant, string>> = {
  search: '搜索',
  read: '读取',
  write: '写入',
  edit: '编辑',
  bash: '命令',
  code: '代码',
  todo: '任务清单',
  job: '后台任务',
  web: '网页',
  agent: '子代理',
  skill: '技能',
  question: '提问',
  image: '图片',
  other: '工具调用',
}
