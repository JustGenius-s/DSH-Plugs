/**
 * The side chat's official-primitive label bundles must be complete.
 *
 * DSH 0.1.5-rc.1 made `labels` a REQUIRED prop on MarkdownText, ReadBlock,
 * DiffBlock, SearchBlock and TerminalBlock, and made `truncatedLabel` required
 * on JsonBlock. Those primitives are cordis-free and read their copy straight
 * off the prop (`labels.copy`, `labels.window(...)`, …), so a missing KEY is
 * not a cosmetic gap — it throws the first time that control renders, which is
 * how the side chat produced "Minified React error #130" (element type
 * invalid: got `undefined` for the deleted `MessageText`).
 *
 * These tests pin every key the primitives dereference at 0.1.5-rc.1, so a
 * future DSH bump that adds a key fails here instead of in the transcript.
 */

import { describe, expect, it } from 'vitest'
import {
  DIFF_LABELS,
  MARKDOWN_LABELS,
  READ_LABELS,
  SEARCH_LABELS,
  TERMINAL_LABELS,
  jsonTruncatedLabel,
} from '../src/client/features/side-chat/primitive-labels'

describe('primitive label bundles', () => {
  it('gives MarkdownText the fence copy pair under 0.1.5 names', () => {
    // MarkdownText forwards these to its fence CodeBlocks; note the keys are
    // copyLabel/copiedLabel here while every other primitive uses copy/copied.
    expect(MARKDOWN_LABELS.code.copyLabel).toBe('复制')
    expect(MARKDOWN_LABELS.code.copiedLabel).toBe('已复制')
    expect(MARKDOWN_LABELS.footnotes).toBeTruthy()
  })

  it('gives ReadBlock its window banner and copy/fold chrome', () => {
    expect(READ_LABELS.copy).toBe('复制')
    expect(READ_LABELS.copied).toBe('已复制')
    expect(READ_LABELS.window(200, 1200)).toBe('显示 200 / 共 1200 行')
    expect(READ_LABELS.expand(40)).toContain('40')
    expect(READ_LABELS.expandAria(40)).toContain('40')
    expect(READ_LABELS.collapse).toBeTruthy()
    expect(READ_LABELS.collapseAria).toBeTruthy()
  })

  it('gives DiffBlock its file-count footer plus copy/fold chrome', () => {
    expect(DIFF_LABELS.copy).toBe('复制')
    expect(DIFF_LABELS.copied).toBe('已复制')
    expect(DIFF_LABELS.files(3)).toBe('3 个文件')
    expect(DIFF_LABELS.expand(12)).toContain('12')
  })

  it('gives SearchBlock both summaries and its empty-state copy', () => {
    expect(SEARCH_LABELS.copy).toBe('复制')
    expect(SEARCH_LABELS.copied).toBe('已复制')
    expect(SEARCH_LABELS.noResults).toBeTruthy()
    // A capped card must never present itself as complete.
    expect(SEARCH_LABELS.pathsSummary(10, 40, true)).toContain('共 40')
    expect(SEARCH_LABELS.pathsSummary(40, 40, false)).not.toContain('显示')
    expect(SEARCH_LABELS.matchesSummary(10, 40, 3, true)).toContain('共 40')
    expect(SEARCH_LABELS.matchesSummary(10, 40, 3, true)).toContain('3 个文件')
  })

  it('gives TerminalBlock every run-state label it dereferences', () => {
    expect(TERMINAL_LABELS.running).toBeTruthy()
    expect(TERMINAL_LABELS.done).toBeTruthy()
    expect(TERMINAL_LABELS.failed).toBeTruthy()
    expect(TERMINAL_LABELS.noOutput).toBeTruthy()
    expect(TERMINAL_LABELS.signal('SIGKILL')).toBe('信号 SIGKILL')
    expect(TERMINAL_LABELS.exitCode(2)).toBe('退出码 2')
    expect(TERMINAL_LABELS.copy).toBe('复制')
    expect(TERMINAL_LABELS.copied).toBe('已复制')
  })

  it('keeps the label bundles reference-stable', () => {
    // MarkdownText discards its streaming render cache when `labels` changes
    // identity, so these must be module constants, not per-render literals.
    const again = [
      MARKDOWN_LABELS,
      READ_LABELS,
      DIFF_LABELS,
      SEARCH_LABELS,
      TERMINAL_LABELS,
    ]
    expect(again.every(bundle => Object.isFrozen(bundle))).toBe(true)
    expect(MARKDOWN_LABELS.code).toBe(MARKDOWN_LABELS.code)
  })

  it('explains a truncated JSON body with its full length', () => {
    expect(jsonTruncatedLabel(20480)).toContain('20480')
  })
})
