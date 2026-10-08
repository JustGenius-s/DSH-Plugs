import { describe, expect, it } from 'vitest'
import { backgroundRefusal } from '../src/background-policy.ts'

const target = { pid: 42, window_id: 73 }
const check = (tool: string, args: unknown = target) => backgroundRefusal(`mcp__cua-driver-mcp__${tool}`, args)

describe('background-first policy before fallback is declared', () => {
  it.each(['start_session', 'end_session', 'get_session', 'get_session_state', 'list_sessions', 'check_permissions', 'health_report'])(
    'admits lifecycle and non-prompting diagnostics: %s', (tool) => {
      expect(check(tool, {})).toBeUndefined()
      expect(backgroundRefusal(`mcp__cua-driver-mcp__${tool}`, {}, 'desktop')).toBeUndefined()
    },
  )
  it('does not let lifecycle or diagnostics grant desktop/OS permissions', () => {
    expect(check('start_session', { capture_scope: 'desktop' })).toContain('cannot grant desktop')
    expect(check('check_permissions', { prompt: true })).toContain('read-only')
    expect(check('check_permissions', { prompt: false })).toBeUndefined()
  })
  it('reports misspelled host tools without calling them Cua policy denials', () => {
    expect(check('computer_pip', {})).toContain('Call computer_pip without an MCP prefix')
    expect(check('computer_window', {})).toContain('Call computer_window without an MCP prefix')
    expect(check('computer_pip_placeholder', {})).toContain('unknown_tool')
    expect(backgroundRefusal('other_cua-driver_helper', {})).toBeUndefined()
  })
  it.each(['bring_to_front', 'invoke_menu', 'drag', 'get_desktop_state', 'start_recording', 'run_code', 'execute_script', 'unknown'])(
    'refuses %s before dispatch', (tool) => expect(check(tool)).toContain('background_first'),
  )
  it.each([
    { delivery_mode: 'foreground' }, { delivery_mode: 'auto' },
    { activate: true }, { focus: true }, { foreground: true }, { bring_to_front: true },
  ])('refuses activation even on a normally allowed tool: %j', (args) => {
    expect(check('click', { ...target, element_token: 'token', ...args })).toContain('background_first')
  })
  it.each(['list_apps', 'list_windows', 'get_window_state', 'get_recording_state', 'launch_app'])(
    'allows reviewed discovery and background launch: %s', (tool) => expect(check(tool)).toBeUndefined(),
  )
  it.each(['click', 'type_text', 'press_key', 'scroll', 'set_window_frame'])(
    'requires exact ownership for %s', (tool) => {
      expect(check(tool, { pid: 42, element_token: 'token' })).toContain('exact pid and window_id')
      expect(check(tool, { ...target, element_token: 'token', delivery_mode: 'background' })).toBeUndefined()
    },
  )
  it('refuses the driver background pixel-click activation path and bare stale indexes', () => {
    for (const args of [{ x: 1, y: 2 }, { element_index: 2 }, { element_token: 'x', button: 'middle' }]) {
      expect(check('click', { ...target, ...args })).toContain('raw pixel clicks')
    }
    expect(check('click', { ...target, element_index: 0, snapshot_id: 'snapshot:real' })).toBeUndefined()
  })
  it('refuses implicit coordinate focus clicks and modified HID clicks', () => {
    expect(check('type_text', { ...target, x: 1, y: 2 })).toContain('coordinate focus')
    expect(check('press_key', { ...target, from_zoom: true })).toContain('coordinate focus')
    expect(check('click', { ...target, element_token: 'token', modifiers: ['cmd'] })).toContain('modified clicks')
    expect(check('click', { ...target, element_token: 'token', modifier: ['cmd'] })).toContain('modified clicks')
    expect(check('click', { ...target, element_token: 'token', action: 'AXRaise' })).toContain('reviewed semantic')
  })
  it('handles native names, structured JSON, and malformed input without bypasses', () => {
    expect(backgroundRefusal('cua_driver_click', JSON.stringify({ ...target, x: 1, y: 2 }))).toContain('raw pixel')
    expect(check('click', '{')).toContain('structured object')
    expect(check('click', [])).toContain('structured object')
    expect(backgroundRefusal('run_code', { code: 'SDK calls are individually guarded' })).toBeUndefined()
    expect(backgroundRefusal('other_tool', {})).toBeUndefined()
  })
})

describe('declared desktop fallback', () => {
  const fallback = (tool: string, args: unknown) =>
    backgroundRefusal(`mcp__cua-driver-mcp__${tool}`, args, { pid: 42, windowId: 73 })

  it.each(['bring_to_front', 'invoke_menu', 'click', 'type_text', 'press_key', 'scroll', 'drag', 'set_window_frame'])(
    'permits %s for the declared exact window', (tool) => {
      expect(fallback(tool, { ...target, delivery_mode: 'foreground' })).toBeUndefined()
      expect(fallback(tool, {
        target: { kind: 'window', ...target }, delivery_mode: 'foreground',
      })).toBeUndefined()
      expect(fallback(tool, { pid: 43, window_id: 74, delivery_mode: 'foreground' })).toContain('another window')
      expect(fallback(tool, { pid: 42 })).toContain('another window')
    },
  )

  it.each(['click', 'type_text', 'press_key', 'scroll', 'drag'])('allows explicit desktop %s without window-coordinate mixing', (tool) => {
    expect(fallback(tool, { scope: 'desktop', x: 40, y: 50 })).toBeUndefined()
    expect(fallback(tool, { target: { kind: 'desktop', display_id: 'primary' }, delivery_mode: 'foreground' })).toBeUndefined()
    expect(check(tool, { scope: 'desktop', x: 40, y: 50 })).toContain('background_first')
    expect(fallback(tool, { x: 40, y: 50 })).toContain('another window')
  })

  it('allows explicit desktop observation but never turns PiP into continuous desktop recording', () => {
    expect(fallback('get_desktop_state', {})).toBeUndefined()
    expect(check('get_desktop_state', {})).toContain('controlMode="desktop"')
    expect(fallback('start_recording', { record_video: true })).toContain('background_first')
    expect(fallback('run_code', { code: 'unreviewed' })).toContain('unreviewed')
    expect(fallback('execute_script', { script: 'unreviewed' })).toContain('unreviewed')
  })

  it.each([
    { scope: 'desktop', ...target },
    { scope: 'desktop', element_token: 'token' },
    { scope: 'desktop', element_index: 1 },
    { scope: 'desktop', snapshot_id: 'snapshot' },
    { scope: 'desktop', from_zoom: true },
    { scope: 'auto', ...target },
    { target: { kind: 'desktop', display_id: 'secondary' } },
    { target: { kind: 'desktop', display_id: 'primary' }, pid: 42 },
    { target: { kind: 'window', ...target }, scope: 'desktop' },
    { target: { kind: 'window', ...target }, window_id: 74 },
    { target: { kind: 'window', ...target }, pid: 43 },
    { target: { kind: 'window', pid: 0, window_id: 73 } },
    { target: { kind: 'anything' } },
  ])('rejects conflicting target and coordinate frames: %j', (args) => {
    expect(fallback('click', args)).toContain('computer_control')
    expect(check('click', args)).toContain('computer_control')
  })

  it('supports MCP and native names without letting caller args grant their own fallback', () => {
    expect(backgroundRefusal('cua_driver_native__click', {
      target: { kind: 'window', ...target }, delivery_mode: 'foreground',
    }, { pid: 42, windowId: 73 })).toBeUndefined()
    expect(check('click', { ...target, x: 1, y: 2, controlMode: 'desktop' })).toContain('background_first')
    expect(fallback('click', { ...target, delivery_mode: 'auto' })).toContain('delivery_mode')
    expect(fallback('click', '{')).toContain('structured object')
  })

  it('keeps nested window targets available for semantic background calls', () => {
    expect(check('click', { target: { kind: 'window', ...target }, element_token: 'real' })).toBeUndefined()
    expect(check('click', { target: { kind: 'desktop', display_id: 'primary' } })).toContain('background_first')
  })
})
