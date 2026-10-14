import { cuaTool } from './shared/cua-tools.ts'
import { computerToolNameRefusal } from './driver-session.ts'
import type { WatchTarget } from './shared/types.ts'

const READ_ONLY = new Set([
  'list_apps', 'list_windows', 'list_displays', 'get_window_state', 'get_app_state',
  'get_menu', 'get_menu_bar', 'list_menus', 'get_app_info', 'get_app_capabilities',
  'get_cursor_state', 'get_recording_state', 'permissions', 'status',
  'get_session', 'get_session_state', 'list_sessions', 'check_permissions', 'health_report',
])
const LIFECYCLE = new Set(['start_session', 'end_session'])
const WINDOW_ACTIONS = new Set(['click', 'type_text', 'set_value', 'press_key', 'scroll', 'set_window_frame'])
const FORBIDDEN = new Set([
  'bring_to_front', 'activate_app', 'focus_window', 'invoke_menu', 'drag',
  'get_desktop_state', 'screenshot', 'capture_screen', 'start_recording',
])
const FOREGROUND_ACTIONS = new Set([...WINDOW_ACTIONS, 'bring_to_front', 'invoke_menu', 'drag'])
const DESKTOP_INPUT = new Set(['click', 'type_text', 'press_key', 'scroll', 'drag'])

const FALLBACK_HINT = 'If background control is unavailable or ineffective, explain the desktop takeover to the user, '
  + 'then call computer_pip(action="control", controlMode="desktop", pid, windowId, reason). '
  + 'For menu-bar/system surfaces without an application window, use controlScope="desktop" with a reason and no window IDs. '
  + 'computer_pip is a host tool; do not add an MCP prefix.'

function parameters(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return undefined }
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

function positiveId(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function hasElement(args: Record<string, unknown>): boolean {
  return typeof args.element_token === 'string' && args.element_token.length > 0
    || typeof args.snapshot_id === 'string' && args.snapshot_id.length > 0
      && typeof args.element_index === 'number' && Number.isSafeInteger(args.element_index) && args.element_index >= 0
}

/** Monotonic, pre-dispatch policy, including Code Mode's native subcalls. */
export function backgroundRefusal(name: string, raw: unknown, desktopTarget?: WatchTarget | 'desktop'): string | undefined {
  const parsed = cuaTool(name)
  if (parsed === undefined) return undefined
  const spelling = computerToolNameRefusal(name)
  if (spelling !== undefined) return spelling
  const tool = parsed.operation
  const args = parameters(raw)
  const deny = (reason: string) => `background_first: ${reason}. ${FALLBACK_HINT}`
  if (args === undefined) return deny('Cua arguments must be a structured object')
  const normalized = normalizeTarget(args)
  if (typeof normalized === 'string') return `computer_control: ${normalized}`
  if (tool === 'check_permissions' && args.prompt !== undefined && args.prompt !== false) {
    return 'computer_control: check_permissions is read-only here; request OS permissions from Settings'
  }
  if (tool === 'start_session' && args.capture_scope !== undefined && !['auto', 'window'].includes(String(args.capture_scope))) {
    return 'computer_control: start_session cannot grant desktop scope; use computer_pip control instead'
  }
  if (desktopTarget !== undefined) {
    if (normalized.delivery_mode !== undefined && !['background', 'foreground'].includes(String(normalized.delivery_mode))) {
      return 'computer_control: delivery_mode must be background or foreground'
    }
    if (tool === 'get_desktop_state') return undefined
    if (FOREGROUND_ACTIONS.has(tool)) {
      if (normalized.scope === 'desktop' && DESKTOP_INPUT.has(tool)) return undefined
      if (desktopTarget === 'desktop') {
        return 'computer_control: this declaration permits only explicit desktop input; declare an exact window for window actions'
      }
      if (normalized.pid !== desktopTarget.pid || normalized.window_id !== desktopTarget.windowId) {
        return 'computer_control: foreground fallback is bound to another window; declare a new target before operating it'
      }
      return undefined
    }
    // The fallback never enables continuous desktop recording or driver-side
    // scripts that would bypass each action's host guard.
  }
  return strictBackgroundRefusal(tool, normalized, deny)
}

function normalizeTarget(args: Record<string, unknown>): Record<string, unknown> | string {
  let normalized = args
  if (args.target !== undefined) {
    const target = parameters(args.target)
    if (target?.kind === 'desktop') {
      if (target.display_id !== 'primary' || args.pid !== undefined || args.window_id !== undefined
        || args.scope !== undefined && args.scope !== 'desktop') return 'conflicting or unsupported desktop target'
      normalized = { ...args, scope: 'desktop' }
    } else if (target?.kind === 'window' && positiveId(target.pid) && positiveId(target.window_id)) {
      if (args.pid !== undefined && args.pid !== target.pid
        || args.window_id !== undefined && args.window_id !== target.window_id
        || args.scope !== undefined && args.scope !== 'window') return 'conflicting window target'
      normalized = { ...args, pid: target.pid, window_id: target.window_id, scope: 'window' }
    } else {
      return 'an exact window or primary desktop target is required'
    }
  }
  if (normalized.scope !== undefined && !['window', 'desktop'].includes(String(normalized.scope))) {
    return 'scope must be window or desktop'
  }
  if (normalized.scope === 'desktop' && (normalized.pid !== undefined || normalized.window_id !== undefined
    || normalized.element_token !== undefined || normalized.element_index !== undefined
    || normalized.snapshot_id !== undefined || normalized.from_zoom === true)) {
    return 'desktop actions cannot mix window identifiers, AX bindings or zoom coordinates'
  }
  return normalized
}

function strictBackgroundRefusal(
  tool: string,
  args: Record<string, unknown>,
  deny: (reason: string) => string,
): string | undefined {
  if (args.delivery_mode !== undefined && args.delivery_mode !== 'background'
    || args.scope !== undefined && args.scope !== 'window'
    || args.activate === true || args.bring_to_front === true
    || args.focus === true || args.foreground === true) {
    return deny('desktop scope, activation and foreground delivery are disabled')
  }
  if (FORBIDDEN.has(tool)) return deny(`${tool} can take over the desktop or has no strict background implementation`)
  if (READ_ONLY.has(tool)) return undefined
  if (LIFECYCLE.has(tool)) return undefined
  if (tool === 'zoom') {
    return positiveId(args.window_id) ? undefined : deny('zoom requires an exact window_id')
  }
  if (tool === 'launch_app') return undefined
  if (!WINDOW_ACTIONS.has(tool)) {
    // Driver-side scripting/batch tools bypass the host's per-action guard.
    // DSH run_code remains available: its subcalls re-enter this guard.
    return deny(`unreviewed Cua operation ${tool}; use individually guarded window tools`)
  }
  if (!positiveId(args.pid) || !positiveId(args.window_id)) return deny('an exact pid and window_id are required')
  if (tool === 'set_value' && !hasElement(args)) return deny('set_value requires a fresh AX element binding')
  if (tool === 'click' && [args.modifier, args.modifiers].some((value) => Array.isArray(value) && value.length > 0)) {
    return deny('modified clicks require foreground HID delivery in this driver')
  }
  if (tool === 'click' && args.action !== undefined
    && !['press', 'show_menu', 'pick', 'confirm', 'cancel', 'open'].includes(String(args.action))) {
    return deny('only reviewed semantic AX actions are allowed')
  }
  if (tool === 'click' && (!hasElement(args) || args.button === 'middle')) {
    return deny('raw pixel clicks may activate the app even in background mode; use a fresh AX element binding')
  }
  if (['type_text', 'press_key'].includes(tool)
    && ['x', 'y', 'from_zoom'].some((key) => args[key] !== undefined)) {
    return deny('coordinate focus clicks may activate the app; address a fresh AX element instead')
  }
  return undefined
}
