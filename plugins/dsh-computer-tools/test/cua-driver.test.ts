import { describe, expect, it } from 'vitest'
import {
  parseDaemonPid,
  parsePermissions,
  probeCuaDriver,
  restartCuaDriver,
} from '../src/cua-driver.ts'

const PERMISSIONS_JSON = JSON.stringify({
  accessibility: true,
  screen_recording: true,
  direct_capture_status: 'not_checked',
  screen_recording_capturable: null,
  direct_capture_error: null,
  source: { bundle_id: 'com.trycua.driver', pid: 54750 },
})

const STATUS_RUNNING = [
  'Cua Driver daemon is running',
  '  socket: /tmp/cua-driver.sock',
  '  pid: 54750',
  '  permission mode: standard (built_in_default)',
].join('\n')

describe('parsePermissions', () => {
  it('maps the tri-state booleans', () => {
    expect(parsePermissions(PERMISSIONS_JSON)).toEqual({
      accessibility: 'granted',
      screenRecording: 'granted',
      directCapture: 'not_checked',
      bundleId: 'com.trycua.driver',
      pid: 54750,
    })
  })

  it('distinguishes denied from unknown', () => {
    const denied = JSON.stringify({ accessibility: false, screen_recording: null })
    expect(parsePermissions(denied)).toMatchObject({
      accessibility: 'denied',
      screenRecording: 'unknown',
    })
  })

  it('returns null on unusable input', () => {
    expect(parsePermissions('not json')).toBeNull()
    expect(parsePermissions('null')).toBeNull()
  })
})

describe('parseDaemonPid', () => {
  it('reads the pid when the daemon runs', () => {
    expect(parseDaemonPid(STATUS_RUNNING)).toBe(54750)
  })

  it('returns null when it is not running', () => {
    expect(parseDaemonPid('Cua Driver daemon is not running')).toBeNull()
    expect(parseDaemonPid('Cua Driver daemon is running')).toBeNull()
  })
})

describe('probeCuaDriver', () => {
  it('reports permissions and the daemon pid', async () => {
    const info = await probeCuaDriver({
      command: 'cua-driver',
      run: async (_file, args) => (args[0] === 'status' ? STATUS_RUNNING : PERMISSIONS_JSON),
    })
    expect(info.running).toBe(true)
    expect(info.pid).toBe(54750)
    expect(info.permissions?.accessibility).toBe('granted')
    expect(info.error).toBeNull()
  })

  it('still reads permissions when no daemon runs', async () => {
    // `status` exits non-zero with no daemon; permissions must survive that.
    const info = await probeCuaDriver({
      command: 'cua-driver',
      run: async (_file, args) => {
        if (args[0] === 'status') throw new Error('exit 1')
        return PERMISSIONS_JSON
      },
    })
    expect(info.running).toBe(false)
    expect(info.permissions?.screenRecording).toBe('granted')
    expect(info.error).toBeNull()
  })

  it('surfaces a probe failure instead of throwing', async () => {
    const info = await probeCuaDriver({
      command: '/missing/cua-driver',
      run: async () => { throw new Error('ENOENT') },
    })
    expect(info.permissions).toBeNull()
    expect(info.running).toBe(false)
    expect(info.error).toContain('ENOENT')
  })
})

describe('restartCuaDriver', () => {
  it('stops the old daemon, waits, then relaunches via LaunchServices', async () => {
    const calls: string[] = []
    const outcome = await restartCuaDriver({
      command: '/Users/x/.local/bin/cua-driver',
      wait: async () => {},
      run: async (file, args) => {
        calls.push([file, ...args].join(' '))
        return ''
      },
    })
    expect(outcome.ok).toBe(true)
    expect(calls[0]).toBe('/Users/x/.local/bin/cua-driver stop')
    // LaunchServices, not the raw binary: that keeps TCC attribution on the app.
    expect(calls[1]).toBe('open -n -g -a /Applications/CuaDriver.app --args serve')
  })

  it('relaunches even when nothing was running to stop', async () => {
    const calls: string[] = []
    const outcome = await restartCuaDriver({
      command: 'cua-driver',
      wait: async () => {},
      run: async (file, args) => {
        const line = [file, ...args].join(' ')
        calls.push(line)
        if (args[0] === 'stop') throw new Error('no daemon')
        return ''
      },
    })
    expect(outcome.ok).toBe(true)
    expect(calls).toContain('open -n -g -a /Applications/CuaDriver.app --args serve')
  })

  it('reports a failed relaunch', async () => {
    const outcome = await restartCuaDriver({
      command: 'cua-driver',
      wait: async () => {},
      run: async (file, args) => {
        if (args[0] === 'stop') return ''
        throw new Error('open failed')
      },
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toContain('open failed')
  })
})
