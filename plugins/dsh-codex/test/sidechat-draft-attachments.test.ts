/**
 * Draft attachment chips, pasted images, and durable image resolution.
 *
 * The adapter pins both the attachment behavior and the DSH service contract:
 *
 * DSH 0.1.5 replaced the old `*DraftImages` calls with a unified draft-
 * attachment API. Validating that face before render prevents a renamed
 * method from taking down the whole Side Chat again.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  conversationAttachmentsOf,
  conversationAttachmentsOfService,
  draftPreviewsOf,
  imageFilesOf,
  resolveImageUrl,
  sideChatPromptContent,
  type ImageApi,
  type SideChatConversationFace,
  type UiConversationFace,
} from '../src/client/features/side-chat/connection'

const file = (name: string, type = 'image/png'): File =>
  ({ name, type, size: 10 }) as unknown as File

const clipboard = (files: File[]): DataTransfer =>
  ({ files, items: [], types: [] }) as unknown as DataTransfer

const conversationFace = (
  overrides: Partial<SideChatConversationFace> = {},
): SideChatConversationFace => ({
  createDrafts: () => [],
  resolveDraftAttachments: () => [],
  serializeDraftAttachments: async () => ({ attachments: [] }),
  releaseDraftAttachment: () => {},
  ...overrides,
})

describe('conversationAttachmentsOf', () => {
  it('accepts the complete DSH 0.1.5 draft-attachment face', () => {
    const conversation = conversationFace()
    expect(conversationAttachmentsOfService(conversation)).toBe(conversation)
    expect(conversationAttachmentsOf({ get: () => conversation })).toBe(conversation)
  })

  it('rejects the removed draftImages face before render', () => {
    const legacy = {
      createDraftImages: () => [],
      draftImages: () => [],
      serializeDraftImages: async () => [],
      releaseDraftImage: () => {},
    }
    expect(conversationAttachmentsOfService(legacy)).toBeUndefined()
  })

  it('rejects an incomplete face and survives a throwing context', () => {
    expect(conversationAttachmentsOfService({ createDrafts: () => [] })).toBeUndefined()
    expect(conversationAttachmentsOf({ get: () => { throw new Error('not injected') } })).toBeUndefined()
  })
})

describe('draftPreviewsOf', () => {
  it('renders each draft with its real preview URL and file name', () => {
    const conversation = conversationFace({
      resolveDraftAttachments: () => [
        { kind: 'image', id: 'd1', previewUrl: 'blob:one', file: file('shot.png') },
        { kind: 'image', id: 'd2', previewUrl: 'blob:two', file: file('photo.jpg', 'image/jpeg') },
      ],
    })
    const previews = draftPreviewsOf(conversation, ['d1', 'd2'])
    expect(previews.map(item => item.url)).toEqual(['blob:one', 'blob:two'])
    expect(previews.map(item => item.name)).toEqual(['shot.png', 'photo.jpg'])
    // The id is what removal releases, so it must survive the mapping.
    expect(previews.map(item => item.id)).toEqual(['d1', 'd2'])
  })

  it('falls back to a glyph when the descriptor carries no preview URL', () => {
    const conversation = conversationFace({
      resolveDraftAttachments: () => [{ kind: 'image', id: 'd1', file: file('a.png') }],
    })
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
    const conversation = conversationFace({
      resolveDraftAttachments: () => [{
        kind: 'image',
        id: 'd1',
        previewUrl: 'blob:x',
        file: undefined as unknown as File,
      }],
    })
    const [preview] = draftPreviewsOf(conversation, ['d1'])
    expect(preview.url).toBe('blob:x')
    expect(preview.name).toBe('图片')
  })

  it('does not call the service for an empty draft', () => {
    const resolveDraftAttachments = vi.fn(() => [])
    expect(draftPreviewsOf({ resolveDraftAttachments }, [])).toEqual([])
    expect(resolveDraftAttachments).not.toHaveBeenCalled()
  })

  it('keeps stale chips removable if resolution fails or omits an id', () => {
    const throwing = conversationFace({
      resolveDraftAttachments: () => { throw new Error('service replaced') },
    })
    expect(draftPreviewsOf(throwing, ['d1'])[0]).toMatchObject({ id: 'd1', name: '图片' })

    const missing = conversationFace({ resolveDraftAttachments: () => [] })
    expect(draftPreviewsOf(missing, ['d2'])[0]).toMatchObject({ id: 'd2', name: '图片' })
  })
})

describe('sideChatPromptContent', () => {
  it('uses the 0.1.5 serializer and places attachments before text', async () => {
    const serializeDraftAttachments = vi.fn(async () => ({ attachments: [
      { type: 'image' as const, mediaType: 'image/png' as const, data: 'AAA', name: 'shot.png' },
      { type: 'file' as const, receiptId: 'receipt-1' },
    ] }))
    const conversation = conversationFace({ serializeDraftAttachments })

    await expect(sideChatPromptContent(conversation, ['d1', 'd2'], 'hello')).resolves.toEqual([
      { type: 'image', mediaType: 'image/png', data: 'AAA', name: 'shot.png' },
      { type: 'file', receiptId: 'receipt-1' },
      { type: 'text', text: 'hello' },
    ])
    expect(serializeDraftAttachments).toHaveBeenCalledWith(['d1', 'd2'])
  })

  it('does not require the service for a text-only prompt', async () => {
    await expect(sideChatPromptContent(undefined, [], 'hello')).resolves.toEqual([
      { type: 'text', text: 'hello' },
    ])
  })

  it('fails instead of silently dropping attachments when the service is absent', async () => {
    await expect(sideChatPromptContent(undefined, ['d1'], 'hello')).rejects.toThrow('附件服务不可用')
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
