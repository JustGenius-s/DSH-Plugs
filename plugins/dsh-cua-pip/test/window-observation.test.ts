import { describe, expect, it } from 'vitest'
import { actionDelivery, actionOutcome, parseWindowAX, planWindowSteps, projectAX, sameBounds, visualElement } from '../src/window-observation.ts'
import type { Frame } from '../src/shared/types.ts'

const target = { pid: 42, windowId: 73 }
const frame: Frame = {
  width: 400, height: 300, mime: 'image/jpeg', base64: 'data', appName: 'App', windowTitle: '',
  windowBounds: { x: -800, y: 100, width: 800, height: 600 },
}
const element = {
  element_index: 0, element_token: 'button', role: 'AXButton', label: 'Run',
  enabled: true, actions: ['AXPress'], frame: { x: -780, y: 120, w: 100, h: 80 },
}
const raw = (over: Record<string, unknown> = {}) => ({
  structuredContent: {
    pid: 42, window_id: 73, snapshot_id: 's1', elements: [element, {
      element_index: 1, element_token: 'field', role: 'AXTextField', label: 'Name', value: 'old',
      frame: { x: -780, y: 220, w: 400, h: 40 },
    }],
    background_input: { exact_window: { pid: 42, window_id: 73 }, routes: [
      { route: 'accessibility', status: 'available' }, { route: 'pid_keyboard', status: 'available' },
    ] }, ...over,
  },
})

describe('canonical bound-window AX state', () => {
  it('preserves real bindings, geometry, actions and capabilities without reading application instructions', () => {
    const ax = parseWindowAX(raw(), target)
    expect(ax.elements[0]).toMatchObject({ index: 0, token: 'button', frame: { x: -780, y: 120, width: 100, height: 80 } })
    expect(ax.routes).toEqual({ accessibility: 'available', window_pointer: 'unknown', pid_keyboard: 'available' })
    expect(parseWindowAX(raw({ background_input: {
      exact_window: { pid: 99, window_id: 73 }, routes: [{ route: 'accessibility', status: 'available' }],
    } }), target).routes.accessibility).toBe('unknown')
  })

  it.each([
    { isError: true }, { structuredContent: { pid: 42, window_id: 73 } }, { content: [{ type: 'text', text: JSON.stringify(raw()) }] },
    raw({ pid: 99 }), raw({ window_id: 99 }), raw({ error: 'refused' }),
    raw({ elements: [element, element] }),
  ])('rejects missing, failed, ambiguous or foreign canonical state', (value) => {
    expect(() => parseWindowAX(value, target)).toThrow('window_observation_invalid')
  })

  it('bounds data shown to the model while retaining complete host-only bindings', () => {
    const elements = Array.from({ length: 2200 }, (_, index) => ({
      ...element, element_index: index, element_token: `token-${index}`, value: 'x'.repeat(2000),
    }))
    const ax = parseWindowAX(raw({ elements }), target), projected = projectAX(ax)
    expect(ax.elements).toHaveLength(2000)
    expect(projected.elements.length).toBeLessThanOrEqual(150)
    expect(Buffer.byteLength(JSON.stringify(projected.elements))).toBeLessThan(33_000)
    expect(projected.elementsTruncated).toBe(true)
    expect(projected.elements[0]).not.toHaveProperty('token')
  })

  it('keeps an honest read-only observation when the driver cannot resolve AX for an off-Space window', () => {
    const ax = parseWindowAX(raw({
      snapshot_id: undefined, elements: [], background_input: {
        exact_window: { pid: 42, window_id: 73, status: 'ax_unresolved' },
        routes: [{ route: 'accessibility', status: 'refused', reason: 'off_space_or_ax_unresolved' }],
      },
    }), target)
    expect(projectAX(ax)).toMatchObject({
      snapshotId: null, elements: [], exactStatus: 'ax_unresolved',
      reasons: { accessibility: 'off_space_or_ax_unresolved' },
    })
    expect(() => planWindowSteps([{ kind: 'click', x: 20, y: 20 }], target, frame, ax, 0))
      .toThrow('off_space_or_ax_unresolved')
  })
})

describe('PiP coordinates and bounded action plans', () => {
  it('maps downscaled image pixels to an exact AX element, including negative monitor origins', () => {
    const ax = parseWindowAX(raw(), target)
    expect(visualElement(frame, ax, 20, 20, 'AXPress').token).toBe('button')
    const plan = planWindowSteps([{ kind: 'click', x: 20, y: 20 }], target, frame, ax, 100)
    expect(plan[0]).toMatchObject({
      targeting: 'pip-pixels-to-ax', operation: 'click', arguments: {
        pid: 42, window_id: 73, element_token: 'button', snapshot_id: 's1', element_index: 0, delivery_mode: 'background',
      },
    })
    expect(plan[0]!.arguments).not.toHaveProperty('x')
    expect(plan[0]!.arguments).not.toHaveProperty('y')
  })

  it.each([[-1, 20], [400, 20], [20, 300], [Infinity, 20], [20, NaN]])('rejects outside/invalid pixels', (x, y) => {
    expect(() => visualElement(frame, parseWindowAX(raw(), target), x, y, 'AXPress')).toThrow('window_coordinates_invalid')
  })

  it('refuses ambiguity, canvas pixels, disabled controls and padded image geometry', () => {
    const duplicate = { ...element, element_index: 3, element_token: 'other' }
    expect(() => visualElement(frame, parseWindowAX(raw({ elements: [element, duplicate] }), target), 20, 20, 'AXPress'))
      .toThrow('ambiguous')
    expect(() => visualElement(frame, parseWindowAX(raw(), target), 300, 250, 'AXPress')).toThrow('background_pointer_unavailable')
    expect(() => visualElement(frame, parseWindowAX(raw({ elements: [{ ...element, enabled: false }] }), target), 20, 20, 'AXPress'))
      .toThrow('background_pointer_unavailable')
    expect(() => visualElement({ ...frame, height: 200 }, parseWindowAX(raw(), target), 20, 20, 'AXPress'))
      .toThrow('window_coordinates_invalid')
  })

  it('validates the entire plan before any input and ends batches at navigation or key dispatch', () => {
    const ax = parseWindowAX(raw(), target)
    expect(planWindowSteps([
      { kind: 'set_value', elementIndex: 1, text: 'new' }, { kind: 'click', elementIndex: 0 },
    ], target, frame, ax, 100)).toHaveLength(2)
    expect(planWindowSteps([{ kind: 'press_key', elementIndex: 1, key: 'Return' }], target, frame, ax, 100)[0]?.arguments)
      .toMatchObject({ key: 'Return', element_token: 'field', delivery_mode: 'background' })
    for (const steps of [
      [], Array.from({ length: 7 }, () => ({ kind: 'set_value' as const, elementIndex: 1, text: 'a' })),
      [{ kind: 'click' as const, elementIndex: 0 }, { kind: 'set_value' as const, elementIndex: 1, text: 'a' }],
    ]) expect(() => planWindowSteps(steps, target, frame, ax, 100)).toThrow('window_batch_invalid')
  })

  it('refuses mismatched coordinates, old AX/image pairing, missing capabilities and unadvertised actions', () => {
    const ax = parseWindowAX(raw(), target)
    expect(() => planWindowSteps([{ kind: 'click', x: 20, y: 20, elementIndex: 0 }], target, frame, ax, 1)).toThrow()
    expect(() => planWindowSteps([{ kind: 'click', x: 20 }], target, frame, ax, 1)).toThrow()
    expect(() => planWindowSteps([{ kind: 'click', x: 20, y: 20 }], target, frame, ax, 2001)).toThrow('skew')
    expect(() => planWindowSteps([{ kind: 'click', elementIndex: 0, action: 'open' }], target, frame, ax, 1)).toThrow('advertise')
    expect(() => planWindowSteps([{ kind: 'click', elementIndex: 0 }], target, frame,
      parseWindowAX(raw({ background_input: {} }), target), 1)).toThrow('background_ax_unavailable')
    expect(() => planWindowSteps([{ kind: 'type_text', elementIndex: 0, text: 'oops' }], target, frame, ax, 1)).toThrow('editable')
  })

  it('never turns set_value into browser script or popup fallback', () => {
    for (const over of [{ in_web_content: true }, { role: 'AXPopUpButton' }]) {
      const ax = parseWindowAX(raw({ elements: [{ ...element, ...over }] }), target)
      expect(() => planWindowSteps([{ kind: 'set_value', elementIndex: 0, text: 'x' }], target, frame, ax, 0))
        .toThrow('window_value_unsupported')
    }
  })

  it('compares geometry without inventing missing coordinates or claiming unknown effects succeeded', () => {
    expect(sameBounds(frame.windowBounds, { ...frame.windowBounds!, x: 0 })).toBe(false)
    expect(sameBounds(undefined, undefined)).toBe(false)
    expect(actionOutcome({ structuredContent: { effect: 'confirmed' } })).toBe('confirmed')
    expect(actionOutcome({ structuredContent: { effect: 'unverifiable', code: 'ax_echo' } })).toBe('unknown')
    expect(actionOutcome({ structuredContent: { verified: true } })).toBe('unknown')
    expect(actionOutcome({ isError: true, structuredContent: { effect: 'confirmed' } })).toBe('failed')
  })

  it('checks canonical route/delivery as well as legacy path without trusting a foreground or missing backend', () => {
    expect(actionDelivery({ structuredContent: { route: 'accessibility', delivery: { mode: 'background' } } }, 'click'))
      .toEqual({ backend: 'accessibility', expected: true })
    expect(actionDelivery({ structuredContent: { path: 'ax' } }, 'click').expected).toBe(true)
    expect(actionDelivery({ structuredContent: { route: 'pid_keyboard', delivery: { mode: 'background' } } }, 'press_key').expected).toBe(true)
    for (const state of [
      { route: 'accessibility', delivery: { mode: 'foreground' } }, { path: 'ax_fg' },
      { route: 'accessibility', delivery: { mode: 'unknown' } },
      { route: 'window_pointer' }, { effect: 'confirmed' }, { route: 'new-unknown-route' },
    ]) expect(actionDelivery({ structuredContent: state }, 'click').expected).toBe(false)
  })
})
