/**
 * Compatibility seam for the official 0.1.7 voice-input contribution. It does
 * not expose recording commands, but its buttons and measured waveform are
 * present in the page. Keep all assumptions about that DOM in this adapter.
 */

const START_LABELS = ['开始录音', 'Start recording']
const STOP_LABELS = ['停止并识别', 'Stop and transcribe']
const CANCEL_LABELS = ['取消', 'Cancel']
const EMPTY_MESSAGES = ['未识别到语音', 'No speech recognized']

function visible(button: HTMLButtonElement): boolean {
  return button.isConnected && button.getClientRects().length > 0 && !button.disabled
}

function labeledButton(root: ParentNode, labels: readonly string[]): HTMLButtonElement | null {
  for (const button of root.querySelectorAll<HTMLButtonElement>('button[aria-label]')) {
    if (labels.includes(button.getAttribute('aria-label') ?? '') && visible(button)) return button
  }
  return null
}

export function voiceRow(phase: string): HTMLElement | null {
  for (const row of document.querySelectorAll<HTMLElement>('[data-voice-activity]')) {
    if (row.dataset.voiceActivity === phase && row.getClientRects().length > 0) return row
  }
  return null
}

export function startVoiceRecording(): boolean {
  const button = labeledButton(document, START_LABELS)
  if (button === null) return false
  button.click()
  return true
}

export function stopVoiceRecording(row: HTMLElement): boolean {
  if (!row.isConnected || row.dataset.voiceActivity !== 'recording') return false
  const button = labeledButton(row, STOP_LABELS)
  if (button === null) return false
  button.click()
  return true
}

export function cancelVoiceRecording(row: HTMLElement): boolean {
  if (!row.isConnected || !['requesting', 'recording', 'feedback'].includes(row.dataset.voiceActivity ?? '')) return false
  const button = labeledButton(row, CANCEL_LABELS)
  if (button === null) return false
  button.click()
  return true
}

/** Inverse of the official Waveform line height: 1 + min(1, RMS × 5) × 17. */
export function voiceWaveformRms(row: HTMLElement): number | undefined {
  if (!row.isConnected || row.dataset.voiceActivity !== 'recording') return undefined
  const newest = row.querySelector('svg[role="img"] line:last-child')
  if (newest === null) return undefined
  const rawY1 = newest.getAttribute('y1')
  const rawY2 = newest.getAttribute('y2')
  if (rawY1 === null || rawY2 === null) return undefined
  const y1 = Number(rawY1)
  const y2 = Number(rawY2)
  if (!Number.isFinite(y1) || !Number.isFinite(y2) || y2 < y1) return undefined
  return Math.min(0.2, Math.max(0, ((y2 - y1) / 2 - 1) / 85))
}

export function voiceFeedbackState(row: HTMLElement): 'pending' | 'empty' | 'other' {
  if (!row.isConnected || row.dataset.voiceActivity !== 'feedback') return 'pending'
  const text = row.querySelector('[role="status"]')?.textContent?.trim()
  if (!text) return 'pending'
  return EMPTY_MESSAGES.includes(text) ? 'empty' : 'other'
}
