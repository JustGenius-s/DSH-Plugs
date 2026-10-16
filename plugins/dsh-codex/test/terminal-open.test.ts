import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { openAgentTerminal, consumeTerminalOpens, startTerminalOpenPoller } from '../src/client/features/terminal/agent-open'
import { TERMINAL_TAB_KIND, terminalResourceControllerId } from '../src/client/features/terminal/contract'
import { mountedSidebarSessionId } from '../src/client/sidebar-right'
import { createTerminalOpenQueue } from '../src/host/terminal/open-queue'
import {
  createOpenTerminalTool,
  createTerminalOpenBridge,
  handleTerminalOpenAck,
  handleTerminalOpenList,
  resolveTerminalCwd,
} from '../src/host/terminal/open-tool'
import {
  OPEN_TERMINAL_TOOL,
  TERMINAL_OPEN_ACK_PATH,
  TERMINAL_OPEN_PATH,
  TERMINAL_OPEN_TIMEOUT_MESSAGE,
  createTerminalResourceAddress,
  isTerminalResourceAddress,
} from '../src/shared/terminal-open'

const ADDRESS = 'dsh-resource://dsh-codex-terminal/fixed'
const caller = (signal = new AbortController().signal) => ({
  agent: { session: { id: 's1' } },
  signal,
}) as never

function toolFor(queue = createTerminalOpenQueue({ timeoutMs: 5_000 })) {
  return {
    queue,
    tool: createOpenTerminalTool({
      cwdFor: () => '/repo',
      queue,
      createAddress: () => ADDRESS,
    }),
  }
}

function failureOf(pending: Promise<unknown>): Promise<Error> {
  return pending.then(
    () => { throw new Error('expected the open to fail') },
    (error: unknown) => error instanceof Error ? error : new Error(String(error)),
  )
}

function captureResponse(): {
  res: ServerResponse
  status: () => number
  json: () => unknown
} {
  let status = 0
  let body = ''
  const res = {
    writeHead(code: number) { status = code },
    end(chunk?: string) { body = chunk ?? '' },
  }
  return {
    res: res as unknown as ServerResponse,
    status: () => status,
    json: () => JSON.parse(body) as unknown,
  }
}

function asRequest(method: string, url: string, body?: unknown): IncomingMessage {
  const payload = body === undefined ? '' : JSON.stringify(body)
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      if (payload !== '') yield Buffer.from(payload)
    },
  } as unknown as IncomingMessage
}

describe('resolveTerminalCwd', () => {
  it('uses the session directory when the request leaves cwd empty', () => {
    expect(resolveTerminalCwd(undefined, '/repo')).toBe('/repo')
    expect(resolveTerminalCwd('  ', '/repo')).toBe('/repo')
    expect(resolveTerminalCwd(undefined, undefined)).toBeUndefined()
  })

  it('keeps an absolute path and joins a relative one', () => {
    expect(resolveTerminalCwd('/tmp/work', '/repo')).toBe('/tmp/work')
    expect(resolveTerminalCwd('src', '/repo')).toBe('/repo/src')
  })

  it('rejects a relative path when the session has no directory', () => {
    expect(() => resolveTerminalCwd('src', undefined)).toThrow('绝对路径')
  })
})

describe('terminal open queue', () => {
  it('claims a session once and completes when the browser confirms', async () => {
    const queue = createTerminalOpenQueue({ timeoutMs: 5_000 })
    const pending = queue.enqueue({
      address: ADDRESS,
      sessionId: 's1',
      cwd: '/repo',
      command: 'pwd',
    })
    expect(queue.claim('s2')).toEqual([])
    expect(queue.claim('s1')).toEqual([{
      address: ADDRESS,
      sessionId: 's1',
      cwd: '/repo',
      command: 'pwd',
    }])
    expect(queue.claim('s1')).toEqual([])
    expect(queue.ack(ADDRESS, { opened: true, commandStarted: true })).toBe(true)
    await expect(pending).resolves.toEqual({ opened: true, commandStarted: true })
    expect(queue.ack(ADDRESS, { opened: true, commandStarted: true })).toBe(false)
    queue.dispose()
  })

  it('rejects a second waiter for the same address', async () => {
    const queue = createTerminalOpenQueue({ timeoutMs: 5_000 })
    const first = queue.enqueue({ address: ADDRESS, sessionId: 's1' })
    await expect(queue.enqueue({ address: ADDRESS, sessionId: 's1' })).
      rejects.toThrow('already waiting')
    queue.cancel(ADDRESS, new Error('stop'))
    await expect(first).rejects.toThrow('stop')
    queue.dispose()
  })

  it('turns a failed open into a rejection and keeps a mounted command error', async () => {
    const queue = createTerminalOpenQueue({ timeoutMs: 5_000 })
    const failed = queue.enqueue({ address: ADDRESS, sessionId: 's1' })
    queue.ack(ADDRESS, { opened: false, commandStarted: false, commandError: '没有挂载' })
    await expect(failed).rejects.toThrow('没有挂载')

    const mounted = queue.enqueue({
      address: 'dsh-resource://dsh-codex-terminal/other',
      sessionId: 's1',
    })
    queue.ack('dsh-resource://dsh-codex-terminal/other', {
      opened: true,
      commandStarted: false,
      commandError: '命令没有提交',
    })
    await expect(mounted).resolves.toMatchObject({ commandStarted: false })
    queue.dispose()
  })

  it('fails when the browser never confirms', async () => {
    vi.useFakeTimers()
    const queue = createTerminalOpenQueue({ timeoutMs: 1_000 })
    try {
      const pending = queue.enqueue({ address: ADDRESS, sessionId: 's1' })
      const failed = failureOf(pending)
      await vi.advanceTimersByTimeAsync(1_000)
      expect((await failed).message).toBe(TERMINAL_OPEN_TIMEOUT_MESSAGE)
    } finally {
      queue.dispose()
      vi.useRealTimers()
    }
  })
})

describe('open_terminal tool', () => {
  it('waits for the browser and reports the tab that mounted', async () => {
    const { queue, tool } = toolFor()
    expect(tool.name).toBe(OPEN_TERMINAL_TOOL)
    expect(tool.presentCall?.({ command: 'pwd', cwd: '/repo' })).toMatchObject({
      card: 'terminal',
      title: 'pwd',
      cwd: '/repo',
    })

    const pending = tool.execute({ command: ' pwd ', cwd: 'src' }, caller())
    const [ticket] = queue.claim('s1')
    expect(ticket).toEqual({
      address: ADDRESS,
      sessionId: 's1',
      cwd: '/repo/src',
      command: 'pwd',
    })
    expect(isTerminalResourceAddress(ticket.address)).toBe(true)
    queue.ack(ticket.address, {
      opened: true,
      commandStarted: false,
      commandError: '命令没有提交',
    })
    const result = await pending
    expect(result).toEqual({
      address: ADDRESS,
      cwd: '/repo/src',
      commandStarted: false,
      commandError: '命令没有提交',
    })
    const rendered = tool.output.render(
      { command: 'pwd', cwd: 'src' },
      result as Parameters<typeof tool.output.render>[1],
    )
    expect(rendered[0]).toMatchObject({ type: 'text' })
    expect((rendered[0] as { text: string }).text).toContain(ADDRESS)
    expect((rendered[0] as { text: string }).text).toContain('命令没有提交')
    queue.dispose()
  })

  it('requires a calling agent and cancels an open that has not been claimed', async () => {
    const { queue, tool } = toolFor()
    await expect(tool.execute({}, { signal: new AbortController().signal } as never)).
      rejects.toThrow('calling agent')

    const controller = new AbortController()
    const pending = tool.execute({}, caller(controller.signal))
    const failed = failureOf(pending)
    controller.abort()
    expect((await failed).message).toContain('已取消')
    expect(queue.claim('s1')).toEqual([])
    queue.dispose()
  })

  it('times out when nothing confirms the tab', async () => {
    vi.useFakeTimers()
    const queue = createTerminalOpenQueue({ timeoutMs: 1_000 })
    const tool = createOpenTerminalTool({
      cwdFor: () => '/repo',
      queue,
      createAddress: () => ADDRESS,
    })
    try {
      const failed = failureOf(tool.execute({}, caller()))
      await vi.advanceTimersByTimeAsync(1_000)
      expect((await failed).message).toBe(TERMINAL_OPEN_TIMEOUT_MESSAGE)
    } finally {
      queue.dispose()
      vi.useRealTimers()
    }
  })
})

describe('terminal open routes', () => {
  it('lists a session once and accepts its ack', async () => {
    const queue = createTerminalOpenQueue({ timeoutMs: 5_000 })
    const pending = queue.enqueue({ address: ADDRESS, sessionId: 's1', cwd: '/repo' })
    const missing = captureResponse()
    handleTerminalOpenList(asRequest('GET', TERMINAL_OPEN_PATH), missing.res, queue)
    expect(missing.status()).toBe(400)

    const listed = captureResponse()
    handleTerminalOpenList(
      asRequest('GET', `${TERMINAL_OPEN_PATH}?sessionId=s1`),
      listed.res,
      queue,
    )
    expect(listed.status()).toBe(200)
    expect(listed.json()).toEqual({
      opens: [{ address: ADDRESS, sessionId: 's1', cwd: '/repo' }],
    })

    const again = captureResponse()
    handleTerminalOpenList(
      asRequest('GET', `${TERMINAL_OPEN_PATH}?sessionId=s1`),
      again.res,
      queue,
    )
    expect(again.json()).toEqual({ opens: [] })

    const acked = captureResponse()
    await handleTerminalOpenAck(asRequest('POST', TERMINAL_OPEN_ACK_PATH, {
      address: ADDRESS,
      opened: true,
      commandStarted: true,
    }), acked.res, queue)
    expect(acked.status()).toBe(200)
    await expect(pending).resolves.toMatchObject({ commandStarted: true })

    const stale = captureResponse()
    await handleTerminalOpenAck(asRequest('POST', TERMINAL_OPEN_ACK_PATH, {
      address: ADDRESS,
      opened: true,
      commandStarted: true,
    }), stale.res, queue)
    expect(stale.status()).toBe(404)
    queue.dispose()
  })

  it('registers the tool and both routes', () => {
    const tools: { name: string }[] = []
    const paths: string[] = []
    const bridge = createTerminalOpenBridge({
      tools: {
        register: (definition: { name: string }) => {
          tools.push(definition)
          return () => { tools.pop() }
        },
      },
      webServer: {
        register: (route: { path: string }) => {
          paths.push(route.path)
          return () => {}
        },
      },
      sessions: { get: () => ({ header: { cwd: '/repo' } }) },
    } as never)
    expect(tools.map(tool => tool.name)).toEqual([OPEN_TERMINAL_TOOL])
    expect(paths).toEqual([TERMINAL_OPEN_PATH, TERMINAL_OPEN_ACK_PATH])
    bridge.dispose()
    expect(tools).toEqual([])
  })
})

describe('openAgentTerminal', () => {
  it('opens a resource tab and submits the command on its own controller', async () => {
    const openResource = vi.fn()
    const run = vi.fn(async () => {})
    const waitFor = vi.fn(async () => ({ run }))
    const result = await openAgentTerminal(
      { openResource },
      { waitFor },
      { address: ADDRESS, sessionId: 's1', cwd: '/repo', command: 'pwd' },
    )
    expect(result).toEqual({ opened: true, commandStarted: true })
    expect(openResource).toHaveBeenCalledWith(ADDRESS, {
      kind: TERMINAL_TAB_KIND,
      revealIfOpened: true,
      params: { cwd: '/repo' },
    })
    expect(waitFor).toHaveBeenCalledWith(terminalResourceControllerId('s1', ADDRESS))
    expect(run).toHaveBeenCalledWith('pwd')
  })

  it('opens in the ticket session when the sidebar can address one', async () => {
    const openResource = vi.fn()
    const openResourceIn = vi.fn()
    const run = vi.fn(async () => {})
    await openAgentTerminal(
      { openResource, openResourceIn },
      { waitFor: vi.fn(async () => ({ run })) },
      { address: ADDRESS, sessionId: 's1', cwd: '/repo', command: 'pwd' },
    )
    expect(openResource).not.toHaveBeenCalled()
    expect(openResourceIn).toHaveBeenCalledWith('s1', ADDRESS, {
      kind: TERMINAL_TAB_KIND,
      revealIfOpened: true,
      params: { cwd: '/repo' },
    })
  })

  it('reports a mounted tab without a command, and a command that did not start', async () => {
    const openResource = vi.fn()
    const waitFor = vi.fn(async () => ({ run: async () => { throw new Error('pty closed') } }))
    const idle = await openAgentTerminal(
      { openResource },
      { waitFor },
      { address: ADDRESS, sessionId: 's1' },
    )
    expect(idle).toEqual({ opened: true, commandStarted: false })
    expect(openResource).toHaveBeenCalledWith(ADDRESS, {
      kind: TERMINAL_TAB_KIND,
      revealIfOpened: true,
    })

    const failed = await openAgentTerminal(
      { openResource },
      { waitFor },
      { address: ADDRESS, sessionId: 's1', command: 'pwd' },
    )
    expect(failed).toEqual({
      opened: true,
      commandStarted: false,
      commandError: 'pty closed',
    })
  })

  it('reports that the tab did not appear', async () => {
    const openResource = vi.fn(() => { throw new Error('no sidebar') })
    const waitFor = vi.fn(async () => ({ run: async () => {} }))
    const refused = await openAgentTerminal(
      { openResource },
      { waitFor },
      { address: ADDRESS, sessionId: 's1' },
    )
    expect(refused.opened).toBe(false)
    expect(refused.commandError).toContain('no sidebar')
    expect(waitFor).not.toHaveBeenCalled()

    const hung = await openAgentTerminal(
      { openResource: vi.fn() },
      { waitFor: () => new Promise(() => {}) },
      { address: ADDRESS, sessionId: 's1' },
      20,
    )
    expect(hung).toEqual({
      opened: false,
      commandStarted: false,
      commandError: '终端标签没有出现',
    })
  })
})

describe('consumeTerminalOpens', () => {
  it('opens each new address once and posts the ack', async () => {
    const seen = new Set<string>()
    const opened: string[] = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith(TERMINAL_OPEN_ACK_PATH)) {
        return { ok: true, json: async () => ({ ok: true }) }
      }
      return {
        ok: true,
        json: async () => ({
          opens: [
            { address: ADDRESS, sessionId: 's1', command: 'pwd' },
            { address: ADDRESS, sessionId: 's1', command: 'pwd' },
            { address: 'dsh-resource://dsh-codex-terminal/other', sessionId: 'other' },
            { address: 'not-a-terminal', sessionId: 's1' },
          ],
        }),
      }
    }) as unknown as typeof fetch

    await consumeTerminalOpens('s1', seen, async ticket => {
      opened.push(ticket.address)
      return { opened: true, commandStarted: true }
    }, fetchImpl)
    await consumeTerminalOpens('s1', seen, async () => {
      throw new Error('replayed')
    }, fetchImpl)

    expect(opened).toEqual([ADDRESS])
    const ack = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .find(call => String(call[0]).startsWith(TERMINAL_OPEN_ACK_PATH))
    const init = ack?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      address: ADDRESS,
      opened: true,
      commandStarted: true,
    })
  })

  it('does not poll when there is no current session, and stops cleanly', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ opens: [] }) }))
    const stop = startTerminalOpenPoller({
      sessionId: () => undefined,
      open: async () => ({ opened: true, commandStarted: false }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      intervalMs: 20,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    stop()
  })
})

describe('mountedSidebarSessionId', () => {
  it('reads the sidebar session and ignores a missing or blank one', () => {
    expect(mountedSidebarSessionId({
      mounted: { getSnapshot: () => 'session-1' },
    })).toBe('session-1')
    expect(mountedSidebarSessionId({ mounted: { getSnapshot: () => undefined } })).toBeUndefined()
    expect(mountedSidebarSessionId({ mounted: { getSnapshot: () => '' } })).toBeUndefined()
    expect(mountedSidebarSessionId({})).toBeUndefined()
  })
})

describe('createTerminalResourceAddress', () => {
  it('keeps a caller-supplied id and still encodes it', () => {
    expect(createTerminalResourceAddress('tab / 1')).toBe(
      'dsh-resource://dsh-codex-terminal/tab%20%2F%201',
    )
  })
})
