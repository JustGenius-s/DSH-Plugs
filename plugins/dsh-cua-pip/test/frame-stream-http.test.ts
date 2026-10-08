import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, it } from 'vitest'
import { streamFrames } from '../src/frame-stream.ts'
import type { FrameResponse } from '../src/shared/types.ts'
import { WatcherRegistry } from '../src/watcher.ts'

it('delivers live frames over HTTP, survives refresh, and ends when its preview closes', async () => {
  let captures = 0
  const registry = new WatcherRegistry({
    fps: 5, backgroundFps: 1, maxDimension: 640, idleTtlMs: 45_000, maxWatchers: 3, autoStart: false,
    listWindows: async () => [],
    capture: async () => ({
      mime: 'image/png', base64: String(++captures), width: 640, height: 480, appName: 'Clock', windowTitle: 'Clock',
    }),
  })
  registry.watch('s1', { pid: 1, windowId: 10 }, { retained: true })
  const server = createServer((req, res) => { streamFrames(registry, 's1', req, res) })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const abort = new AbortController()
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, { signal: abort.signal })
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const nextFrame = async (): Promise<FrameResponse> => {
      while (!buffer.includes('\n\n')) {
        const next = await reader.read()
        if (next.done) throw new Error('stream ended before the next event')
        buffer += decoder.decode(next.value, { stream: true })
      }
      const end = buffer.indexOf('\n\n')
      const event = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      return JSON.parse(event.split('data: ')[1]!)
    }
    expect((await nextFrame()).state?.frame).toBeNull()
    await registry.tickNow('s1')
    expect((await nextFrame()).state?.frame?.base64).toBe('1')
    await registry.tickNow('s1')
    expect((await nextFrame()).state?.frame?.base64).toBe('2')

    registry.refresh('s1')
    expect(await nextFrame()).toMatchObject({ watching: true, state: { frame: null } })
    await registry.tickNow('s1')
    expect((await nextFrame()).state?.frame?.base64).toBe('3')

    registry.unwatch('s1')
    expect(await nextFrame()).toEqual({ ok: true, watching: false })
    expect((await reader.read()).done).toBe(true)
    expect(registry.size).toBe(0)
  } finally {
    abort.abort()
    registry.dispose()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
