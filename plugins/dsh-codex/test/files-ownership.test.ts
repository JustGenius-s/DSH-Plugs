import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/shared/config'
import {
  FILES_TAB_ID,
  FILES_TAB_KIND,
  filesTabDefinition,
} from '../src/client/features/files/files-tab'
import {
  FILE_VIEWER_KIND,
  fileViewerDefinition,
} from '../src/client/features/files/file-viewer'

describe('Files ownership', () => {
  it('delegates file previews to DSH until the user opts into the custom viewer', () => {
    expect(DEFAULT_CONFIG.customFilesEnabled).toBe(false)
  })

  it('takes over the built-in files page only through the extension band', () => {
    const definition = filesTabDefinition(key => key)

    expect(definition.id).toBe(FILES_TAB_ID)
    expect(definition.kind).toBe(FILES_TAB_KIND)
    expect(definition.priority).toBe('extension')
    expect(definition.guide).toHaveLength(1)
  })

  it('registers a separate resource viewer for custom file previews', () => {
    const definition = fileViewerDefinition(key => key)

    expect(definition.kind).toBe(FILE_VIEWER_KIND)
    expect(definition.kind).not.toBe('files')
    expect(definition.guide).toBeUndefined()
    expect(definition.canOpen?.('dsh-resource://file/session/s1/src/a.ts')).toBe(true)
    expect(definition.canOpen?.('dsh-resource://file/session/s1/out/demo.html')).toBe(false)
    expect(definition.canOpen?.('dsh-resource://file/session/s1/icon.svg')).toBe(false)
    expect(definition.canOpen?.('dsh-resource://file/session/s1/README.md')).toBe(false)
    expect(definition.canOpen?.('dsh-resource://file/session/s1/notes.markdown')).toBe(false)
  })
})
