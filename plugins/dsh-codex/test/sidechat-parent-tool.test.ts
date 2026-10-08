import { describe, expect, it, vi } from 'vitest'
import { createSideChatParentTool, SIDE_CHAT_READ_PARENT_TOOL } from '../src/host/side-chat/parent-tool'

const sideId = 'session-side' as never
const parentId = 'session-parent' as never
const caller = (id: string) => ({ agent: { session: { id } } }) as never

function user(text: string) {
  return { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } }
}

function assistant(text: string) {
  return { type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } }
}

describe('side chat main-session read tool', () => {
  it('reads current history only when called and never runs in another session', async () => {
    let events: unknown[] = [user('Original task'), assistant('Original result')]
    const readSurface = vi.fn(async () => ({ events }))
    const ctx = {
      sessions: { get: (id: string) => id === parentId ? { id, header: {} } : undefined },
      get: (name: string) => name === 'sessionQuery' ? { readSurface } : undefined,
      logger: { warn: vi.fn() },
    } as never
    const tool = createSideChatParentTool(ctx, sideId, parentId)
    expect(tool.name).toBe(SIDE_CHAT_READ_PARENT_TOOL)
    expect(readSurface).not.toHaveBeenCalled()

    await expect(tool.execute({}, caller('another-side'))).rejects.toThrow('owning side chat')
    expect(readSurface).not.toHaveBeenCalled()

    const first = await tool.execute({}, caller(sideId)) as { text: string }
    expect(first.text).toContain('Original result')
    expect(readSurface).toHaveBeenCalledExactlyOnceWith(parentId)

    events = [user('New task'), assistant('New result')]
    const latest = await tool.execute({}, caller(sideId)) as { text: string }
    expect(latest.text).toContain('New result')
    expect(latest.text).not.toContain('Original task')
  })

  it('reports unavailable history without inventing parent activity', async () => {
    const logger = { warn: vi.fn() }
    const ctx = {
      sessions: { get: () => ({ id: parentId, header: {} }) },
      get: () => ({ readSurface: async () => { throw new Error('read failed') } }),
      logger,
    } as never
    const tool = createSideChatParentTool(ctx, sideId, parentId)
    const result = await tool.execute({}, caller(sideId)) as { text: string }
    expect(result.text).toContain('读取主会话失败')
    expect(logger.warn).toHaveBeenCalledOnce()
  })
})
