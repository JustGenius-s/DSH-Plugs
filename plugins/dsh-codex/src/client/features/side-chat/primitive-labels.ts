/**
 * Localized chrome for the official content primitives.
 *
 * DSH 0.1.5 made `labels` a REQUIRED prop on MarkdownText, ReadBlock,
 * DiffBlock, SearchBlock and TerminalBlock, and made `truncatedLabel` required
 * on JsonBlock. The primitives are cordis-free, so they take their copy
 * through props — a caller that omits it crashes the moment the component
 * dereferences `labels.copy`, which is exactly what broke the side chat
 * (see ../../../../docs and the pinned 0.1.5-rc.1 contract).
 *
 * The shapes mirror the primitives' own label interfaces structurally, so
 * this module stays free of any official import (a plugin source may only
 * import the shared runtime/UI boundary) and stays testable without React.
 *
 * Every bundle is a module-level frozen constant on purpose: MarkdownText
 * discards its streaming render cache when `labels` changes identity, so a
 * freshly built object per render would re-parse the whole reply on every
 * chunk.
 */

/** Copy-button pair, shared by every primitive that offers one. */
export interface CopyLabels {
  copy: string
  copied: string
}

/** Collapse/expand chrome for a height-capped card. */
export interface FoldLabels extends CopyLabels {
  collapseAria: string
  collapse: string
  expandAria: (hidden: number) => string
  expand: (hidden: number) => string
}

/** Fold chrome plus the file count a footer reports. */
export interface DiffLikeLabels extends FoldLabels {
  files: (count: number) => string
}

/**
 * `MarkdownText` fence labels (0.1.5's `MarkdownCodeLabels`).
 *
 * Named `copyLabel`/`copiedLabel` here — unlike every other primitive, which
 * uses `copy`/`copied` — so the pair must not be aliased to {@link CopyLabels}.
 */
export interface MarkdownCodeCopyLabels {
  copyLabel: string
  copiedLabel: string
}

/** `MarkdownText` labels (0.1.5: `labels`, replacing 0.1.0's `codeLabels`). */
export interface MarkdownTextLabels {
  code: MarkdownCodeCopyLabels
  footnotes: string
}

/** `ReadBlock` labels. */
export interface ReadCardLabels extends FoldLabels {
  /** "showing N of M" for a window that is not the whole file. */
  window: (shown: number, total: number) => string
}

/** `SearchBlock` labels: one summary per `kind`. */
export interface SearchCardLabels extends FoldLabels {
  pathsSummary: (shown: number, total: number, truncated: boolean) => string
  matchesSummary: (shown: number, total: number, files: number, truncated: boolean) => string
  noResults: string
}

/** `TerminalBlock` labels. */
export interface TerminalCardLabels extends FoldLabels {
  signal: (signal: string) => string
  exitCode: (exitCode: number) => string
  running: string
  failed: string
  done: string
  noOutput: string
}

const COPY_LABELS: Readonly<CopyLabels> = Object.freeze({ copy: '复制', copied: '已复制' })

/** Shared fold chrome: the wording is identical across every capped card. */
function foldLabels(): FoldLabels {
  return {
    ...COPY_LABELS,
    collapseAria: '折叠',
    collapse: '折叠',
    expandAria: (hidden: number) => `展开其余 ${hidden} 行`,
    expand: (hidden: number) => `展开其余 ${hidden} 行`,
  }
}

/** Markdown document chrome (footnote heading + fence copy buttons). */
export const MARKDOWN_LABELS: Readonly<MarkdownTextLabels> = Object.freeze({
  code: Object.freeze({ copyLabel: '复制', copiedLabel: '已复制' }),
  footnotes: '脚注',
})

export const READ_LABELS: Readonly<ReadCardLabels> = Object.freeze({
  ...foldLabels(),
  window: (shown: number, total: number) => `显示 ${shown} / 共 ${total} 行`,
})

export const DIFF_LABELS: Readonly<DiffLikeLabels> = Object.freeze({
  ...foldLabels(),
  files: (count: number) => `${count} 个文件`,
})

export const SEARCH_LABELS: Readonly<SearchCardLabels> = Object.freeze({
  ...foldLabels(),
  pathsSummary: (shown: number, total: number, truncated: boolean) =>
    (truncated ? `显示 ${shown} / 共 ${total} 个路径` : `${total} 个路径`),
  matchesSummary: (shown: number, total: number, files: number, truncated: boolean) => {
    const count = truncated ? `显示 ${shown} / 共 ${total} 处匹配` : `${total} 处匹配`
    return `${count} · ${files} 个文件`
  },
  noResults: '无匹配结果',
})

export const TERMINAL_LABELS: Readonly<TerminalCardLabels> = Object.freeze({
  ...foldLabels(),
  signal: (signal: string) => `信号 ${signal}`,
  exitCode: (exitCode: number) => `退出码 ${exitCode}`,
  running: '运行中',
  failed: '失败',
  done: '完成',
  noOutput: '无输出',
})

/**
 * JsonBlock's truncation footer, given the full serialized length.
 *
 * Required since 0.1.5 (it was optional in 0.1.0-rc.6), so an omitted handler
 * threw as soon as a payload crossed the primitive's own character cap.
 */
export function jsonTruncatedLabel(total: number): string {
  return `… (共 ${total} 字符，已截断)`
}
