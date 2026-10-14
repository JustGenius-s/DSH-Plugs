import { describe, expect, it } from 'vitest'
import {
  captureVoiceShortcut,
  formatVoiceShortcut,
  matchesVoiceShortcut,
  resolveVoiceShortcut,
  type ShortcutKeyEvent,
} from '../src/client/features/voice-input/shortcut'

function key(code: string, modifiers: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent {
  return { code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...modifiers }
}

describe('voice shortcut binding', () => {
  it('keeps the default primary modifier portable across macOS and Windows', () => {
    const binding = 'Mod+Shift+KeyM'
    expect(formatVoiceShortcut(binding, true)).toBe('⌘⇧M')
    expect(formatVoiceShortcut(binding, false)).toBe('Ctrl+Shift+M')
    expect(matchesVoiceShortcut(key('KeyM', { metaKey: true, shiftKey: true }), binding, true)).toBe(true)
    expect(matchesVoiceShortcut(key('KeyM', { ctrlKey: true, shiftKey: true }), binding, false)).toBe(true)
    expect(matchesVoiceShortcut(key('KeyM', { ctrlKey: true, shiftKey: true }), binding, true)).toBe(false)
  })

  it('captures a selected combination and matches exactly that combination', () => {
    const captured = captureVoiceShortcut(key('KeyK', { metaKey: true, altKey: true }), true)
    expect(captured).toEqual({ kind: 'captured', binding: 'Meta+Alt+KeyK' })
    expect(matchesVoiceShortcut(key('KeyK', { metaKey: true, altKey: true }), 'Meta+Alt+KeyK', true)).toBe(true)
    expect(matchesVoiceShortcut(key('KeyK', { metaKey: true, altKey: true, shiftKey: true }), 'Meta+Alt+KeyK', true)).toBe(false)
    expect(matchesVoiceShortcut(key('KeyK', { metaKey: true, altKey: true, repeat: true }), 'Meta+Alt+KeyK', true)).toBe(false)
    expect(matchesVoiceShortcut(key('KeyK', { metaKey: true, altKey: true, isComposing: true }), 'Meta+Alt+KeyK', true)).toBe(false)
  })

  it('accepts function keys but rejects ordinary typing and modifier-only presses', () => {
    expect(captureVoiceShortcut(key('F8', { altKey: true }), false)).toEqual({ kind: 'captured', binding: 'Alt+F8' })
    expect(captureVoiceShortcut(key('KeyB'), false)).toEqual({ kind: 'invalid' })
    expect(captureVoiceShortcut(key('ShiftLeft', { shiftKey: true }), false)).toEqual({ kind: 'pending' })
    expect(captureVoiceShortcut(key('Escape'), false)).toEqual({ kind: 'cancel' })
  })

  it('rejects browser shortcuts and falls back safely for malformed saved values', () => {
    expect(captureVoiceShortcut(key('KeyW', { metaKey: true }), true)).toEqual({ kind: 'reserved' })
    expect(captureVoiceShortcut(key('KeyR', { ctrlKey: true, shiftKey: true }), false)).toEqual({ kind: 'reserved' })
    expect(captureVoiceShortcut(key('F4', { altKey: true }), false)).toEqual({ kind: 'reserved' })
    expect(resolveVoiceShortcut('Shift+KeyM', true)).toBe('Mod+Shift+KeyM')
    expect(resolveVoiceShortcut('Mod+Meta+KeyM', true)).toBe('Mod+Shift+KeyM')
    expect(resolveVoiceShortcut('Mod+KeyW', false)).toBe('Mod+Shift+KeyM')
  })
})
