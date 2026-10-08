import { DEFAULT_VOICE_SHORTCUT } from '../../../shared/config'

const MODIFIERS = ['Mod', 'Control', 'Meta', 'Alt', 'Shift'] as const
type Modifier = typeof MODIFIERS[number]

export interface ShortcutKeyEvent {
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  repeat?: boolean
  isComposing?: boolean
  defaultPrevented?: boolean
}

interface Binding {
  code: string
  modifiers: Set<Modifier>
}

function supportedCode(code: string): boolean {
  return /^Key[A-Z]$|^Digit[0-9]$|^F(?:[1-9]|1[0-2])$/.test(code)
}

function encode(binding: Binding): string {
  return [...MODIFIERS.filter(modifier => binding.modifiers.has(modifier)), binding.code].join('+')
}

function parse(value: string, mac: boolean): Binding | undefined {
  const parts = value.split('+')
  const code = parts.pop()
  if (code === undefined || !supportedCode(code)) return undefined
  const modifiers = new Set<Modifier>()
  for (const part of parts) {
    if (!MODIFIERS.includes(part as Modifier) || modifiers.has(part as Modifier)) return undefined
    modifiers.add(part as Modifier)
  }
  if (!modifiers.has('Mod') && !modifiers.has('Control') && !modifiers.has('Meta') && !modifiers.has('Alt')) return undefined
  // Mod aliases the native primary key; listing both makes a confusing binding.
  if (modifiers.has('Mod') && modifiers.has(mac ? 'Meta' : 'Control')) return undefined
  return { code, modifiers }
}

function physicalModifiers(binding: Binding, mac: boolean): Pick<ShortcutKeyEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'> {
  return {
    ctrlKey: binding.modifiers.has('Control') || (!mac && binding.modifiers.has('Mod')),
    metaKey: binding.modifiers.has('Meta') || (mac && binding.modifiers.has('Mod')),
    altKey: binding.modifiers.has('Alt'),
    shiftKey: binding.modifiers.has('Shift'),
  }
}

/** Reject common browser/app commands that a page-level listener must not take over. */
function reserved(binding: Binding, mac: boolean): boolean {
  const { ctrlKey, metaKey, altKey, shiftKey } = physicalModifiers(binding, mac)
  const primary = mac ? metaKey && !ctrlKey : ctrlKey && !metaKey
  if (primary && !altKey) {
    if (!shiftKey && /^(?:Key[ACFLNOPQRSTVWXZ])$/.test(binding.code)) return true
    if (shiftKey && /^(?:Key[CIJNQRTW])$/.test(binding.code)) return true
  }
  return !mac && binding.code === 'F4' && altKey && !ctrlKey && !metaKey
}

export function resolveVoiceShortcut(value: string, mac: boolean): string {
  const binding = parse(value, mac)
  return binding !== undefined && !reserved(binding, mac) ? encode(binding) : DEFAULT_VOICE_SHORTCUT
}

export type CaptureResult =
  | { kind: 'pending' | 'cancel' | 'invalid' | 'reserved' }
  | { kind: 'captured'; binding: string }

/** A capture field and the runtime use the same accepted key vocabulary. */
export function captureVoiceShortcut(event: ShortcutKeyEvent, mac: boolean): CaptureResult {
  if (event.code === 'Escape') return { kind: 'cancel' }
  if (event.repeat || event.isComposing || /^(?:Control|Meta|Alt|Shift)(?:Left|Right)$/.test(event.code)) {
    return { kind: 'pending' }
  }
  if (!supportedCode(event.code) || !(event.ctrlKey || event.metaKey || event.altKey)) return { kind: 'invalid' }
  const modifiers = new Set<Modifier>()
  if (event.ctrlKey) modifiers.add('Control')
  if (event.metaKey) modifiers.add('Meta')
  if (event.altKey) modifiers.add('Alt')
  if (event.shiftKey) modifiers.add('Shift')
  const binding = { code: event.code, modifiers }
  return reserved(binding, mac) ? { kind: 'reserved' } : { kind: 'captured', binding: encode(binding) }
}

export function matchesVoiceShortcut(event: ShortcutKeyEvent, value: string, mac: boolean): boolean {
  if (event.repeat || event.isComposing || event.defaultPrevented) return false
  const binding = parse(resolveVoiceShortcut(value, mac), mac)
  if (binding === undefined || event.code !== binding.code) return false
  const expected = physicalModifiers(binding, mac)
  return event.ctrlKey === expected.ctrlKey
    && event.metaKey === expected.metaKey
    && event.altKey === expected.altKey
    && event.shiftKey === expected.shiftKey
}

export function formatVoiceShortcut(value: string, mac: boolean): string {
  const binding = parse(resolveVoiceShortcut(value, mac), mac)!
  const key = binding.code.startsWith('Key') ? binding.code.slice(3)
    : binding.code.startsWith('Digit') ? binding.code.slice(5)
      : binding.code
  if (mac) {
    return [...MODIFIERS.filter(modifier => binding.modifiers.has(modifier))]
      .map(modifier => ({ Mod: '⌘', Control: '⌃', Meta: '⌘', Alt: '⌥', Shift: '⇧' })[modifier])
      .join('') + key
  }
  return [...MODIFIERS.filter(modifier => binding.modifiers.has(modifier))]
    .map(modifier => ({ Mod: 'Ctrl', Control: 'Ctrl', Meta: 'Win', Alt: 'Alt', Shift: 'Shift' })[modifier])
    .concat(key)
    .join('+')
}
