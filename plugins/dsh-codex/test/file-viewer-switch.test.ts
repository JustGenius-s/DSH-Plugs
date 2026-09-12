import { describe, expect, it, vi } from 'vitest'
import type { SidebarRightService } from '@just-genius/dsh-plugin-runtime/client'
import {
  FILE_VIEWER_KIND,
  OFFICIAL_FILE_VIEWER_KIND,
  switchActiveFileViewer,
} from '../src/client/features/files/file-viewer'

function sidebarWithActive(kind: string, contentId = 'dsh-resource://file/session/s1/src/a.ts') {
  const openResource = vi.fn()
  const sidebar = {
    active: () => ({ id: 'tab-1', kind, contentId, title: 'a.ts' }),
    openResource,
  } as unknown as Pick<SidebarRightService, 'active' | 'openResource'>
  return { sidebar, openResource }
}

describe('switchActiveFileViewer', () => {
  it('replaces the current official file tab with the custom viewer', () => {
    const { sidebar, openResource } = sidebarWithActive(OFFICIAL_FILE_VIEWER_KIND)

    expect(switchActiveFileViewer(sidebar, true)).toBe(true)
    expect(openResource).toHaveBeenCalledWith(
      'dsh-resource://file/session/s1/src/a.ts',
      {
        kind: FILE_VIEWER_KIND,
        replaceTab: 'tab-1',
        revealIfOpened: false,
      },
    )
  })

  it('returns the current custom file tab to normal DSH resource resolution', () => {
    const { sidebar, openResource } = sidebarWithActive(FILE_VIEWER_KIND)

    expect(switchActiveFileViewer(sidebar, false)).toBe(true)
    expect(openResource).toHaveBeenCalledWith(
      'dsh-resource://file/session/s1/src/a.ts',
      {
        replaceTab: 'tab-1',
        revealIfOpened: false,
      },
    )
  })

  it('keeps an official HTML preview instead of stealing it for the custom viewer', () => {
    const { sidebar, openResource } = sidebarWithActive(
      OFFICIAL_FILE_VIEWER_KIND,
      'dsh-resource://file/session/s1/out/demo.html',
    )

    expect(switchActiveFileViewer(sidebar, true)).toBe(false)
    expect(openResource).not.toHaveBeenCalled()
  })

  it('hands a leftover custom HTML tab back to the official preview', () => {
    const { sidebar, openResource } = sidebarWithActive(
      FILE_VIEWER_KIND,
      'dsh-resource://file/session/s1/icon.svg',
    )

    expect(switchActiveFileViewer(sidebar, true)).toBe(true)
    expect(openResource).toHaveBeenCalledWith(
      'dsh-resource://file/session/s1/icon.svg',
      {
        kind: OFFICIAL_FILE_VIEWER_KIND,
        replaceTab: 'tab-1',
        revealIfOpened: false,
      },
    )
  })

  it('keeps an official Markdown preview instead of stealing it', () => {
    const { sidebar, openResource } = sidebarWithActive(
      OFFICIAL_FILE_VIEWER_KIND,
      'dsh-resource://file/session/s1/README.md',
    )

    expect(switchActiveFileViewer(sidebar, true)).toBe(false)
    expect(openResource).not.toHaveBeenCalled()
  })

  it('leaves unrelated and already-correct tabs alone', () => {
    const custom = sidebarWithActive(FILE_VIEWER_KIND)
    const terminal = sidebarWithActive('terminal', 'sidebar://terminal')

    expect(switchActiveFileViewer(custom.sidebar, true)).toBe(false)
    expect(switchActiveFileViewer(terminal.sidebar, true)).toBe(false)
    expect(custom.openResource).not.toHaveBeenCalled()
    expect(terminal.openResource).not.toHaveBeenCalled()
  })
})
