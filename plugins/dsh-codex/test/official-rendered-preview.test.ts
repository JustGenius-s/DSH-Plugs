import { describe, expect, it } from 'vitest'
import {
  officialRenderedPreviewExtension,
  usesOfficialRenderedPreview,
} from '../src/client/features/files/official-rendered-preview'

describe('officialRenderedPreviewExtension', () => {
  it('matches official visual document suffixes', () => {
    expect(officialRenderedPreviewExtension('out/demo.html')).toBe('html')
    expect(officialRenderedPreviewExtension('Logo.SVG')).toBe('svg')
    expect(officialRenderedPreviewExtension('docs\\chart.PDF')).toBe('pdf')
    expect(officialRenderedPreviewExtension('img/photo.jpeg')).toBe('jpeg')
    expect(officialRenderedPreviewExtension('README.md')).toBe('md')
    expect(officialRenderedPreviewExtension('notes.MARKDOWN')).toBe('markdown')
  })

  it('leaves source files to the custom viewer', () => {
    expect(officialRenderedPreviewExtension('src/app.ts')).toBeUndefined()
    expect(officialRenderedPreviewExtension('index.xhtml')).toBeUndefined()
    expect(officialRenderedPreviewExtension('html')).toBeUndefined()
  })
})

describe('usesOfficialRenderedPreview', () => {
  it('accepts a workspace path or a session file address', () => {
    expect(usesOfficialRenderedPreview('preview/index.htm')).toBe(true)
    expect(usesOfficialRenderedPreview(
      'dsh-resource://file/session/s1/preview/index.htm',
    )).toBe(true)
    expect(usesOfficialRenderedPreview(
      'dsh-resource://file/session/s1/src/a.ts',
    )).toBe(false)
  })
})
