import { describe, expect, it } from 'vitest'
import {
  findOrphans,
  parsePsOutput,
  reapOrphans,
  type ProcessRow,
} from '../src/reaper.ts'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PW_PROFILE = '/var/folders/xx/T/playwright_chromiumdev_profile-6cvZBO'

/** A Playwright-launched Chromium owned by `ppid`. */
function playwrightChrome(pid: number, ppid: number): ProcessRow {
  return {
    pid,
    ppid,
    command: `${CHROME} --disable-field-trial-config --headless --user-data-dir=${PW_PROFILE} --remote-debugging-pipe`,
  }
}

/** The user's own Chrome: same binary, no Playwright profile. */
function userChrome(pid: number, ppid = 1): ProcessRow {
  return {
    pid,
    ppid,
    command: `${CHROME} --no-startup-window`,
  }
}

function mcp(pid: number, ppid: number): ProcessRow {
  return {
    pid,
    ppid,
    command: `/usr/bin/node /Users/x/.dsh/profiles/web/node_modules/@playwright/mcp/cli.js --headless`,
  }
}

/** The running DSH host that owns the MCP servers. */
function host(pid: number): ProcessRow {
  return {
    pid,
    ppid: 1,
    command: `/usr/bin/node /Users/x/.dsh/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js web --host 127.0.0.1 --port 53649`,
  }
}

describe('parsePsOutput', () => {
  it('reads pid, ppid, and the verbatim command', () => {
    const rows = parsePsOutput('  123     1 /usr/bin/foo --bar baz\n')
    expect(rows).toEqual([{ pid: 123, ppid: 1, command: '/usr/bin/foo --bar baz' }])
  })

  it('skips rows without a numeric header', () => {
    expect(parsePsOutput('header line\nnot a row\n')).toEqual([])
  })
})

describe('findOrphans', () => {
  it('reaps a Playwright browser whose parent is gone', () => {
    // ppid 900 is not in the table: its MCP died with the host.
    const rows = [playwrightChrome(51096, 900)]
    expect(findOrphans(rows)).toEqual([
      { pid: 51096, kind: 'browser', detail: 'playwright chromium' },
    ])
  })

  it('reaps a launchd-adopted orphan even though launchd itself is in the table', () => {
    // The real snapshot contains launchd, so an orphan's ppid 1 is present.
    const rows = [
      { pid: 1, ppid: 0, command: '/sbin/launchd' },
      playwrightChrome(51096, 1),
    ]
    expect(findOrphans(rows)).toEqual([
      { pid: 51096, kind: 'browser', detail: 'playwright chromium' },
    ])
  })

  it('reaps an MCP server whose parent is gone', () => {
    const rows = [mcp(16359, 1)]
    expect(findOrphans(rows)).toEqual([{ pid: 16359, kind: 'mcp', detail: 'playwright/mcp' }])
  })

  it('leaves a browser alone while its MCP parent is alive', () => {
    // The whole live chain from one running host down to its browser.
    const rows = [host(50), mcp(100, 50), playwrightChrome(200, 100)]
    expect(findOrphans(rows)).toEqual([])
  })

  it('leaves an MCP server alone while its host is alive', () => {
    const rows = [host(50), mcp(100, 50)]
    expect(findOrphans(rows)).toEqual([])
  })

  it('never touches the user\'s own Chrome', () => {
    // Same binary and even the same ppid=1 shape, but no Playwright profile.
    const rows = [userChrome(94985)]
    expect(findOrphans(rows)).toEqual([])
  })

  it('ignores Chromium Helper children', () => {
    const helper: ProcessRow = {
      pid: 300,
      ppid: 200,
      command: `${CHROME} Helper --type=gpu-process --user-data-dir=${PW_PROFILE}`,
    }
    expect(findOrphans([helper])).toEqual([])
  })

  it('ignores unrelated processes that merely mention the marker', () => {
    // This is the shape a grep/bash command line takes while inspecting them.
    const probe: ProcessRow = {
      pid: 400,
      ppid: 399,
      command: `bash -c echo 'playwright_chromiumdev_profile' | grep ${CHROME}`,
    }
    expect(findOrphans([probe])).toEqual([])
  })

  it('reaps both when a host died leaving MCP and browser behind', () => {
    const rows = [mcp(100, 1), playwrightChrome(200, 1)]
    expect(findOrphans(rows).map((t) => t.kind)).toEqual(['mcp', 'browser'])
  })
})

describe('reapOrphans', () => {
  it('does nothing when no orphan matches', async () => {
    let signalled = 0
    const report = await reapOrphans({
      rows: [userChrome(1)],
      signal: () => { signalled += 1; return true },
    })
    expect(report.found).toEqual([])
    expect(signalled).toBe(0)
  })

  it('SIGTERMs first and records what exited, without escalating', async () => {
    const sent: Array<{ pid: number; signal: string }> = []
    // The process is gone by the time the grace period ends.
    const report = await reapOrphans({
      rows: [playwrightChrome(51096, 900)],
      wait: async () => {},
      signal: (pid, signal) => { sent.push({ pid, signal }); return true },
      isAlive: () => false,
    })
    expect(sent).toEqual([{ pid: 51096, signal: 'SIGTERM' }])
    expect(report.terminated).toEqual([51096])
    expect(report.killed).toEqual([])
  })

  it('escalates to SIGKILL only for survivors', async () => {
    const sent: Array<{ pid: number; signal: string }> = []
    const report = await reapOrphans({
      rows: [playwrightChrome(51096, 900)],
      wait: async () => {},
      signal: (pid, signal) => { sent.push({ pid, signal }); return true },
      isAlive: () => true,
    })
    expect(sent).toEqual([
      { pid: 51096, signal: 'SIGTERM' },
      { pid: 51096, signal: 'SIGKILL' },
    ])
    expect(report.terminated).toEqual([])
    expect(report.killed).toEqual([51096])
  })

  it('reports a failed signal instead of claiming success', async () => {
    const report = await reapOrphans({
      rows: [mcp(16359, 1)],
      wait: async () => {},
      signal: () => { throw new Error('EPERM') },
      isAlive: () => true,
    })
    expect(report.terminated).toEqual([])
    expect(report.killed).toEqual([])
    expect(report.failed[0]?.pid).toBe(16359)
    expect(report.failed[0]?.error).toContain('EPERM')
  })
})
