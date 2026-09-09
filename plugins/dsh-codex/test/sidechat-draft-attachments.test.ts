/**
 * Draft attachment chips, pasted images, and durable image resolution.
 *
 * Three things were broken here and each is pinned by a test:
 *
 * 1. The composer serialized attachments with its own FileReader, which
 *    produced a full `data:image/png;base64,…` URL where the wire expects
 *    BARE base64 — so an uploaded image never rendered.
 * 2. There was no paste handler at all, so a copied image could only be
 *    attached by saving it to disk and using the file picker.
 * 3. Chips were placeholder glyphs: the draft's real preview URL (the thing
 *    the main composer renders) was never read.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  draftPreviewsOf,
  imageFilesOf,
  resolveImageUrl,
  type ImageApi,
  type UiConversationFace,
} from '../src/client/features/side-chat/connection'

const file = (name: string, type = 'image/png'): File =>
  ({ name, type, size: 10 }) as unknown as File

const clipboard = (files: File[]): DataTransfer =>
  ({ files, items: [], types: [] }) as unknown as DataTransfer

describe('draftPreviewsOf', () => {
  it('renders each draft with its real preview URL and file name', () => {
    const conversation = {
      draftImages: () => [
        { id: 'd1', previewUrl: 'blob:one', file: file('shot.png') },
        { id: 'd2', previewUrl: 'blob:two', file: file('photo.jpg', 'image/jpeg') },
      ],
    }
    const previews = draftPreviewsOf(conversation, ['d1', 'd2'])
    expect(previews.map(item => item.url)).toEqual(['blob:one', 'blob:two'])
    expect(previews.map(item => item.name)).toEqual(['shot.png', 'photo.jpg'])
    // The id is what removal releases, so it must survive the mapping.
    expect(previews.map(item => item.id)).toEqual(['d1', 'd2'])
  })

  it('falls back to a glyph when the descriptor carries no preview URL', () => {
    const conversation = { draftImages: () => [{ id: 'd1', file: file('a.png') }] }
    const [preview] = draftPreviewsOf(conversation, ['d1'])
    expect(preview.url).toBeUndefined()
    expect(preview.name).toBe('a.png')
  })

  it('survives a conversation face that is not mounted yet', () => {
    const previews = draftPreviewsOf(undefined, ['d1'])
    expect(previews).toHaveLength(1)
    expect(previews[0].url).toBeUndefined()
  })

  it('handles a descriptor with no file (name unknown)', () => {
    const conversation = { draftImages: () => [{ id: 'd1', previewUrl: 'blob:x' }] }
    const [preview] = draftPreviewsOf(conversation, ['d1'])
    expect(preview.url).toBe('blob:x')
    expect(preview.name).toBe('图片')
  })
})

describe('imageFilesOf', () => {
  it('takes the images off a pasted clipboard', () => {
    const data = clipboard([file('a.png'), file('b.jpg', 'image/jpeg')])
    expect(imageFilesOf(data)).toHaveLength(2)
  })

  it('ignores a text-only paste so the textarea keeps its own behaviour', () => {
    // Returning empty is what lets a pasted snippet land in the draft.
    expect(imageFilesOf(clipboard([]))).toEqual([])
    expect(imageFilesOf(clipboard([file('notes.txt', 'text/plain')]))).toEqual([])
  })

  it('survives a clipboard with no file list at all', () => {
    expect(imageFilesOf(null)).toEqual([])
    expect(imageFilesOf({ files: undefined } as unknown as DataTransfer)).toEqual([])
  })
})

describe('resolveImageUrl', () => {
  const sessionId = 'sess-1'
  const attachment = { attachmentId: 'att-1', name: 'shot.png' }

  it('prefers uiConversation, the API the main transcript uses', async () => {
    const uiConversation: UiConversationFace = {
      imageUrl: vi.fn(async () => 'https://host/img'),
    }
    const api: ImageApi = { sessions: { attachment: vi.fn() } }
    await expect(resolveImageUrl({ attachment, sessionId, api, uiConversation })).resolves.toBe('https://host/img')
    // The bespoke read must not also fire.
    expect(api.sessions?.attachment).not.toHaveBeenCalled()
  })

  it('uses a cached preview without a round-trip when one exists', async () => {
    const imageUrl = vi.fn(async () => 'https://host/fresh')
    const uiConversation: UiConversationFace = {
      imageUrl,
      peekImageUrl: () => 'https://host/cached',
    }
    await expect(resolveImageUrl({ attachment, sessionId, uiConversation })).resolves.toBe('https://host/cached')
    expect(imageUrl).not.toHaveBeenCalled()
  })

  it('ignores an empty cached preview', async () => {
    const uiConversation: UiConversationFace = {
      imageUrl: async () => 'https://host/fresh',
      peekImageUrl: () => '',
    }
    await expect(resolveImageUrl({ attachment, sessionId, uiConversation })).resolves.toBe('https://host/fresh')
  })

  it('falls back to the transport read when uiConversation is absent', async () => {
    const api: ImageApi = { session: { attachment: async () => ({ data: 'data:image/png;base64,AA' }) } }
    await expect(resolveImageUrl({ attachment, sessionId, api })).resolves.toBe('data:image/png;base64,AA')
  })

  it('rejects a block with no attachment id', async () => {
    const uiConversation: UiConversationFace = { imageUrl: vi.fn() }
    await expect(resolveImageUrl({ attachment: {}, sessionId, uiConversation })).rejects.toThrow('no attachment id')
    expect(uiConversation.imageUrl).not.toHaveBeenCalled()
  })

  it('rejects when no transport is mounted', async () => {
    await expect(resolveImageUrl({ attachment, sessionId })).rejects.toThrow('no image transport')
  })
})
