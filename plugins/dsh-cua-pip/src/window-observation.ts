import type { CuaWindowBounds, Frame, WatchTarget } from './shared/types.ts'

export type Row = Record<string, unknown>
export const MAX_AX_ELEMENTS = 2000
export const MAX_BATCH_STEPS = 6
export const MAX_OBSERVATION_SKEW_MS = 2000

export function row(value: unknown): Row | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : undefined
}

export function failed(value: Row): boolean {
  return value.isError === true || value.ok === false || value.success === false
    || ['failed', 'refused', 'suspected_noop'].includes(String(value.effect))
    || ['error', 'failed', 'refused'].includes(String(value.status)) || Boolean(value.error)
    || typeof value.code === 'string' && value.code !== '' && typeof value.effect !== 'string'
      && value.ok !== true && value.success !== true
}

export function bounds(value: unknown): CuaWindowBounds | undefined {
  const candidate = row(value)
  if (candidate === undefined) return undefined
  const x = candidate.x, y = candidate.y
  const width = candidate.width ?? candidate.w, height = candidate.height ?? candidate.h
  if (![x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))
    || Number(width) <= 0 || Number(height) <= 0) return undefined
  return { x: Number(x), y: Number(y), width: Number(width), height: Number(height) }
}

export function sameBounds(left: CuaWindowBounds | undefined, right: CuaWindowBounds | undefined): boolean {
  return left !== undefined && right !== undefined
    && ['x', 'y', 'width', 'height'].every((key) => left[key as keyof CuaWindowBounds] === right[key as keyof CuaWindowBounds])
}

export interface WindowElement {
  index: number
  token: string
  role: string
  label: string
  value: string | null
  frame: CuaWindowBounds | null
  enabled: boolean | null
  actions: string[]
  webContent: boolean
}

export interface WindowAX {
  snapshotId: string | null
  elements: WindowElement[]
  truncated: boolean
  routes: Record<'accessibility' | 'window_pointer' | 'pid_keyboard', 'available' | 'refused' | 'unknown'>
  reasons: Record<'accessibility' | 'window_pointer' | 'pid_keyboard', string | null>
  exactStatus: string | null
}

/** Keep complete bindings in the host; only bounded, useful AX text enters context. */
export function projectAX(ax: WindowAX) {
  const elements = []
  let bytes = 0
  for (const element of ax.elements) {
    const { token: _token, frame, ...rest } = element
    const projected = { ...rest, frame: frame === null ? null : { ...frame } }
    bytes += Buffer.byteLength(JSON.stringify(projected))
    if (elements.length >= 150 || bytes > 32_000) break
    elements.push(projected)
  }
  return {
    snapshotId: ax.snapshotId, elements, elementsTruncated: ax.truncated || elements.length < ax.elements.length,
    exactStatus: ax.exactStatus, routes: { ...ax.routes }, reasons: { ...ax.reasons },
  }
}

/** Only the driver's canonical structure may supply action bindings. */
export function parseWindowAX(value: unknown, target: WatchTarget): WindowAX {
  const envelope = row(value)
  const state = row(envelope?.structuredContent)
  if (envelope === undefined || state === undefined || failed(envelope) || failed(state)
    || state.pid !== target.pid || state.window_id !== target.windowId
    || !Array.isArray(state.elements)
    || state.elements.length > 0 && (typeof state.snapshot_id !== 'string' || !state.snapshot_id)) {
    throw new Error('window_observation_invalid: expected a successful canonical AX snapshot of the exact bound window')
  }
  const elements: WindowElement[] = []
  const indices = new Set<number>(), tokens = new Set<string>()
  for (const value of state.elements.slice(0, MAX_AX_ELEMENTS)) {
    const element = row(value)
    if (element === undefined || !Number.isSafeInteger(element.element_index) || Number(element.element_index) < 0
      || typeof element.element_token !== 'string' || !element.element_token || element.element_token.length > 1024) continue
    const index = Number(element.element_index), token = element.element_token
    if (indices.has(index) || tokens.has(token)) throw new Error('window_observation_invalid: ambiguous AX bindings')
    indices.add(index); tokens.add(token)
    elements.push({
      index, token, role: String(element.role ?? '').slice(0, 80),
      label: String(element.label ?? '').slice(0, 256),
      value: typeof element.value === 'string' ? element.value.slice(0, 512) : null,
      frame: bounds(element.frame) ?? null,
      enabled: typeof element.enabled === 'boolean' ? element.enabled : null,
      actions: Array.isArray(element.actions) ? element.actions.filter((v): v is string =>
        typeof v === 'string' && /^AX[A-Za-z]+$/.test(v)).slice(0, 20) : [],
      webContent: element.in_web_content === true,
    })
  }
  const routes: WindowAX['routes'] = { accessibility: 'unknown', window_pointer: 'unknown', pid_keyboard: 'unknown' }
  const reasons: WindowAX['reasons'] = { accessibility: null, window_pointer: null, pid_keyboard: null }
  const background = row(state.background_input), exact = row(background?.exact_window)
  if (exact?.pid === target.pid && exact.window_id === target.windowId && Array.isArray(background?.routes)) {
    for (const value of background.routes) {
      const route = row(value)
      if (route !== undefined && Object.hasOwn(routes, String(route.route))
        && ['available', 'refused', 'unknown'].includes(String(route.status))) {
        routes[route.route as keyof typeof routes] = route.status as typeof routes.accessibility
        reasons[route.route as keyof typeof reasons] = typeof route.reason === 'string' ? route.reason.slice(0, 256) : null
      }
    }
  }
  return {
    snapshotId: typeof state.snapshot_id === 'string' && state.snapshot_id ? state.snapshot_id : null,
    elements, routes, reasons, exactStatus: typeof exact?.status === 'string' ? exact.status.slice(0, 80) : null,
    truncated: state.elements.length > MAX_AX_ELEMENTS,
  }
}

const AX_ACTIONS: Record<string, string> = {
  press: 'AXPress', show_menu: 'AXShowMenu', pick: 'AXPick', confirm: 'AXConfirm', cancel: 'AXCancel', open: 'AXOpen',
}
export interface WindowStep {
  kind: 'click' | 'set_value' | 'type_text' | 'press_key'
  elementIndex?: number
  x?: number
  y?: number
  action?: string
  text?: string
  key?: string
}
export interface PlannedStep {
  operation: WindowStep['kind']
  arguments: Record<string, unknown>
  element: WindowElement
  targeting: 'ax-index' | 'pip-pixels-to-ax'
}

/** Coordinates describe this exact native image, never Cua's thumbnail cache. */
export function visualElement(frame: Frame, ax: WindowAX, x: number, y: number, action: string): WindowElement {
  const geometry = frame.windowBounds
  if (geometry === undefined || !Number.isFinite(x) || !Number.isFinite(y)
    || x < 0 || y < 0 || x >= frame.width || y >= frame.height
    || Math.abs(frame.width - frame.height * geometry.width / geometry.height) > 2) {
    throw new Error('window_coordinates_invalid: use pixels inside the complete observed PiP frame')
  }
  const screenX = geometry.x + x * geometry.width / frame.width
  const screenY = geometry.y + y * geometry.height / frame.height
  const matches = ax.elements.filter((element) => {
    const rect = element.frame
    return rect !== null && element.enabled !== false && element.actions.includes(action)
      && screenX >= rect.x && screenX < rect.x + rect.width && screenY >= rect.y && screenY < rect.y + rect.height
      && rect.x >= geometry.x && rect.y >= geometry.y
      && rect.x + rect.width <= geometry.x + geometry.width && rect.y + rect.height <= geometry.y + geometry.height
  })
  if (matches.length !== 1) throw new Error(matches.length === 0
    ? 'background_pointer_unavailable: no actionable AX element at that pixel; raw pointer fallback is disabled'
    : 'window_coordinates_ambiguous: overlapping actionable elements; select a fresh AX index instead')
  return matches[0]!
}

/** Validate every step before the first input; batches contain no branches. */
export function planWindowSteps(
  steps: readonly WindowStep[], target: WatchTarget, frame: Frame, ax: WindowAX, skewMs: number,
): PlannedStep[] {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > MAX_BATCH_STEPS) {
    throw new Error(`window_batch_invalid: provide 1-${MAX_BATCH_STEPS} deterministic steps`)
  }
  return steps.map((step, index) => {
    if (!['click', 'set_value', 'type_text', 'press_key'].includes(step.kind)) throw new Error('window_action_unsupported')
    const allowed = new Set(['kind', 'elementIndex', ...(step.kind === 'click' ? ['x', 'y', 'action']
      : step.kind === 'press_key' ? ['key'] : ['text'])])
    if (Object.keys(step).some((key) => !allowed.has(key))) throw new Error('window_batch_invalid: conflicting action fields')
    // Only value writes may precede another action. Navigation/submission/key
    // dispatch always ends a batch, before any new decision or coordinates.
    if (index < steps.length - 1 && !['set_value', 'type_text'].includes(step.kind)) {
      throw new Error('window_batch_invalid: clicks and key presses must be the last step')
    }
    if (ax.routes.accessibility !== 'available' || ax.snapshotId === null) {
      throw new Error(`background_ax_unavailable: ${ax.reasons.accessibility ?? 'exact-window AX route is not available'}`)
    }
    const action = step.action ?? 'press'
    const axAction = AX_ACTIONS[action]
    const pixel = step.x !== undefined || step.y !== undefined
    if (pixel && (step.kind !== 'click' || step.elementIndex !== undefined || step.x === undefined || step.y === undefined)) {
      throw new Error('window_coordinates_invalid: specify either elementIndex or both x and y')
    }
    if (pixel && (!Number.isFinite(skewMs) || skewMs > MAX_OBSERVATION_SKEW_MS)) {
      throw new Error('window_observation_skew: AX and image are too far apart for visual targeting; observe again')
    }
    const element = pixel
      ? visualElement(frame, ax, step.x!, step.y!, axAction ?? '')
      : ax.elements.find((element) => element.index === step.elementIndex)
    if (element === undefined || element.enabled === false) throw new Error('window_element_unavailable: use an enabled element from this observation')
    if (step.kind === 'click' && (axAction === undefined || !element.actions.includes(axAction))) {
      throw new Error('window_action_unsupported: the selected element does not advertise this AX action')
    }
    if (['set_value', 'type_text'].includes(step.kind)
      && (typeof step.text !== 'string' || step.text.length > 10_000)) throw new Error('window_text_invalid')
    if (step.kind === 'type_text' && !['AXTextField', 'AXTextArea', 'AXComboBox'].includes(element.role)) {
      throw new Error('window_text_unsupported: address an observed editable element')
    }
    if (step.kind === 'set_value' && (element.webContent
      || !['AXTextField', 'AXTextArea', 'AXSlider', 'AXStepper'].includes(element.role))) {
      throw new Error('window_value_unsupported: set_value is limited to native editable controls; no script fallback')
    }
    if (step.kind === 'press_key' && (typeof step.key !== 'string' || !/^[a-zA-Z0-9_]{1,32}$/.test(step.key)
      || ax.routes.pid_keyboard !== 'available')) throw new Error('background_keyboard_unavailable')
    const args: Record<string, unknown> = {
      pid: target.pid, window_id: target.windowId, element_token: element.token,
      snapshot_id: ax.snapshotId, element_index: element.index,
    }
    if (step.kind !== 'set_value') args.delivery_mode = 'background'
    if (step.kind === 'click') { args.action = action; args.button = 'left' }
    if (step.kind === 'set_value') args.value = step.text
    if (step.kind === 'type_text') args.text = step.text
    if (step.kind === 'press_key') args.key = step.key
    return { operation: step.kind, arguments: args, element, targeting: pixel ? 'pip-pixels-to-ax' : 'ax-index' }
  })
}

export function actionOutcome(value: unknown): 'confirmed' | 'unknown' | 'failed' {
  const envelope = row(value), state = row(envelope?.structuredContent)
  if (envelope === undefined || failed(envelope) || state === undefined || failed(state)) return 'failed'
  return state.effect === 'confirmed' ? 'confirmed' : 'unknown'
}

export function actionDelivery(value: unknown, operation: WindowStep['kind']) {
  const state = row(row(value)?.structuredContent)
  const route = state?.route ?? state?.path
  const backend = typeof route === 'string' ? route : null
  const allowed = ['click', 'set_value'].includes(operation)
    ? ['ax', 'accessibility'] : ['ax', 'accessibility', 'pid_keyboard', 'cgevent']
  const mode = row(state?.delivery)?.mode
  return {
    backend,
    expected: backend !== null && allowed.includes(backend) && (mode === undefined || mode === 'background'),
  }
}
