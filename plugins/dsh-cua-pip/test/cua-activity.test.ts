import { describe, expect, it } from 'vitest'
import {
  applyCuaEvent,
  coalesceUsableTarget,
  extractPid,
  extractWatchTarget,
  isCuaToolName,
  isHijackCapture,
  pickActivity,
  pickConversationActivity,
  pickRebindCandidate,
  readPersistedCurrentSessionId,
  resolveCurrentSessionId,
  shouldOpenOverlay,
} from '../src/shared/cua-activity.ts'
import type { CuaActivity, CuaWindow } from '../src/shared/types.ts'

const call = (name: string, args: unknown, turn = 1) => ({
  type: 'tool/call',
  data: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args), turn },
})

const activity = (over: Partial<CuaActivity> = {}): CuaActivity => ({
  sessionId: 's1',
  active: true,
  visible: true,
  tool: 'mcp__cua-driver-mcp__click',
  target: { pid: 1, windowId: 2 },
  turn: 1,
  updatedAt: 10,
  ...over,
})

describe('isCuaToolName', () => {
  it('matches Cua Driver MCP names', () => {
    expect(isCuaToolName('mcp__cua-driver-mcp__get_window_state')).toBe(true)
    expect(isCuaToolName('mcp__cua-driver-mcp__click')).toBe(true)
    expect(isCuaToolName('cua-driver')).toBe(true)
    expect(isCuaToolName('@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp')).toBe(true)
  })

  it('rejects browser-use, bare computer-use, and this plugin', () => {
    expect(isCuaToolName('mcp__playwright-mcp__browser_click')).toBe(false)
    expect(isCuaToolName('computer-use')).toBe(false)
    expect(isCuaToolName('dsh-cua-pip')).toBe(false)
    expect(isCuaToolName('bash')).toBe(false)
  })
})

describe('extractWatchTarget / extractPid', () => {
  it('reads top-level snake_case', () => {
    expect(extractWatchTarget({ pid: 33403, window_id: 61847 })).toEqual({ pid: 33403, windowId: 61847 })
  })

  it('reads nested Cua target and camelCase', () => {
    expect(extractWatchTarget({
      target: { kind: 'window', pid: 9, window_id: 8 },
    })).toEqual({ pid: 9, windowId: 8 })
    expect(extractWatchTarget({ pid: '3', windowId: '4' })).toEqual({ pid: 3, windowId: 4 })
  })

  it('parses a JSON string and rejects incomplete args', () => {
    expect(extractWatchTarget('{"pid":1,"window_id":2}')).toEqual({ pid: 1, windowId: 2 })
    expect(extractWatchTarget({ pid: 1 })).toBeUndefined()
    expect(extractWatchTarget('not-json')).toBeUndefined()
    expect(extractWatchTarget('')).toBeUndefined()
  })

  it('extracts pid from top-level or nested target', () => {
    expect(extractPid({ pid: 12 })).toBe(12)
    expect(extractPid({ target: { pid: 34, kind: 'window' } })).toBe(34)
    expect(extractPid({})).toBeUndefined()
  })
})

describe('applyCuaEvent', () => {
  it('never opens PiP from a computer-use event', () => {
    expect(applyCuaEvent(undefined, 's1', call('mcp__cua-driver-mcp__click', { pid: 1, window_id: 2 }), 100))
      .toBeUndefined()
    const closed = activity({ visible: false })
    expect(applyCuaEvent(closed, 's1', call('mcp__cua-driver-mcp__click', { pid: 1, window_id: 2 }, 2), 100))
      .toBe(closed)
  })

  it('updates an explicitly opened preview without changing its confirmed target', () => {
    const opened = applyCuaEvent(activity(), 's1', call('mcp__cua-driver-mcp__click', { pid: 3, window_id: 4 }), 100)
    expect(opened?.target).toEqual({ pid: 1, windowId: 2 })
    expect(opened?.visible).toBe(true)
    expect(opened?.updatedAt).toBe(100)
    const kept = applyCuaEvent(opened, 's1', call('mcp__cua-driver-mcp__list_windows', {}, 1), 200)
    expect(kept?.target).toEqual({ pid: 1, windowId: 2 })
    expect(kept?.active).toBe(true)
    expect(kept?.updatedAt).toBe(200)
  })

  it('ignores non-Cua tools and stays visible on turn/end', () => {
    const opened = applyCuaEvent(activity(), 's1', call('mcp__cua-driver-mcp__click', { pid: 1, window_id: 2 }), 100)
    expect(applyCuaEvent(opened, 's1', call('bash', { command: 'ls' }), 150)).toBe(opened)
    const ended = applyCuaEvent(opened, 's1', { type: 'turn/end', data: { reason: { kind: 'completed' } } }, 300)
    expect(ended?.active).toBe(false)
    expect(ended?.visible).toBe(true)
    expect(ended?.tool).toBeNull()
    expect(ended?.target).toEqual({ pid: 1, windowId: 2 })
  })
})

describe('pickActivity', () => {
  it('prefers the current session, else the newest active burst', () => {
    const a = activity({ sessionId: 'old', updatedAt: 1 })
    const b = activity({ sessionId: 'cur', updatedAt: 2, target: { pid: 3, windowId: 4 } })
    const idle = activity({ sessionId: 'idle', active: false, visible: false, updatedAt: 9 })
    expect(pickActivity([a, b, idle], 'cur')?.sessionId).toBe('cur')
    expect(pickActivity([a, idle], 'missing')?.sessionId).toBe('old')
    expect(pickActivity([idle])).toBeUndefined()
  })
})

describe('pickConversationActivity', () => {
  it('only returns the open conversation stream', () => {
    const a = activity({ sessionId: 'old', updatedAt: 1 })
    const b = activity({ sessionId: 'cur', updatedAt: 2 })
    expect(pickConversationActivity([a, b], 'cur')?.sessionId).toBe('cur')
    expect(pickConversationActivity([a, b], 'missing')).toBeUndefined()
    expect(pickConversationActivity([a], undefined)).toBeUndefined()
    expect(pickConversationActivity([activity({ sessionId: 'cur', active: false })], 'cur')?.sessionId).toBe('cur')
    expect(pickConversationActivity([activity({ sessionId: 'cur', visible: false })], 'cur')).toBeUndefined()
  })
})

describe('resolveCurrentSessionId', () => {
  it('reads list current, object current, then persisted json', () => {
    expect(resolveCurrentSessionId('s1', '{"sessionId":"s2"}')).toBe('s1')
    expect(resolveCurrentSessionId({ sessionId: 's3' }, null)).toBe('s3')
    expect(readPersistedCurrentSessionId('{"sessionId":"s4"}')).toBe('s4')
    expect(resolveCurrentSessionId(undefined, '{"sessionId":"s4"}')).toBe('s4')
    expect(resolveCurrentSessionId(undefined, null)).toBeUndefined()
  })
})

describe('isHijackCapture / coalesceUsableTarget', () => {
  const overlay: CuaWindow = {
    pid: 4456,
    windowId: 63495,
    appName: 'universalAccessAuthWarn',
    title: '录屏',
    bounds: { x: 662, y: 273, width: 461, height: 181 },
    isOnScreen: true,
  }
  const dsh: CuaWindow = {
    pid: 33403,
    windowId: 61847,
    appName: 'DSH-Desktop',
    title: 'DeepSeek Harness',
    bounds: { x: 0, y: 33, width: 1728, height: 1021 },
    isOnScreen: true,
  }

  it('flags the Screen Recording consent overlay', () => {
    expect(isHijackCapture('universalAccessAuthWarn', '录屏')).toBe(true)
    expect(isHijackCapture('UniversalAccessAuthWarn', 'Screen Recording')).toBe(true)
    expect(isHijackCapture('DSH-Desktop', 'DeepSeek Harness')).toBe(false)
  })

  it('drops a latched overlay target instead of rebinding onto it', () => {
    expect(coalesceUsableTarget([overlay, dsh], { pid: 4456, windowId: 63464 })).toBeNull()
    expect(pickRebindCandidate([overlay], 4456)).toBeUndefined()
  })

  it('keeps a live app window and rebinds a stale id on the same pid', () => {
    expect(coalesceUsableTarget([overlay, dsh], { pid: 33403, windowId: 61847 })).toEqual({
      pid: 33403,
      windowId: 61847,
    })
    expect(coalesceUsableTarget([dsh], { pid: 33403, windowId: 1 })).toEqual({
      pid: 33403,
      windowId: 61847,
    })
    expect(coalesceUsableTarget([overlay, dsh], null, 33403)).toEqual({
      pid: 33403,
      windowId: 61847,
    })
    expect(coalesceUsableTarget([overlay, dsh], null)).toBeNull()
    expect(coalesceUsableTarget([overlay, dsh], { pid: 4456, windowId: 63464 }, 33403)).toEqual({
      pid: 33403,
      windowId: 61847,
    })
  })
})

describe('shouldOpenOverlay', () => {
  it('opens an active burst and respects a same-turn dismiss', () => {
    const row = activity()
    expect(shouldOpenOverlay(row, null)).toBe(true)
    expect(shouldOpenOverlay(undefined, null)).toBe(false)
    expect(shouldOpenOverlay({ ...row, active: false }, null)).toBe(true)
    expect(shouldOpenOverlay({ ...row, visible: false }, null)).toBe(false)
    expect(shouldOpenOverlay(row, { sessionId: 's1', turn: 1 })).toBe(false)
    expect(shouldOpenOverlay({ ...row, turn: 2 }, { sessionId: 's1', turn: 1 })).toBe(true)
    expect(shouldOpenOverlay({ ...row, sessionId: 's2' }, { sessionId: 's1', turn: 1 })).toBe(true)
  })
})
