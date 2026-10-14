import type { SettingsScope } from '@just-genius/dsh-plugin-runtime/client'
import { DEFAULT_CONFIG, type DshCodexConfig } from '../../../shared/config'
import type { CodexFeature } from '../../core/feature-manager'
import {
  cancelVoiceRecording,
  startVoiceRecording,
  stopVoiceRecording,
  voiceFeedbackState,
  voiceRow,
  voiceWaveformRms,
} from '../../host-adapters/voice-dom'
import { VoiceSilenceTracker } from './silence'
import { matchesVoiceShortcut, resolveVoiceShortcut } from './shortcut'

const SAMPLE_INTERVAL_MS = 100

function visibleDialog(): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
    .some(dialog => dialog.getClientRects().length > 0)
}

/** The official voice UI owns the microphone and transcription; Codex owns only controls. */
export function createVoiceInputFeature(scope: SettingsScope<DshCodexConfig>): CodexFeature {
  return {
    id: 'voice-input-controls',
    activate() {
      const mac = navigator.platform.toLowerCase().includes('mac')
      let config: DshCodexConfig = { ...DEFAULT_CONFIG, ...scope.getSnapshot().value }
      let shortcut = resolveVoiceShortcut(config.voiceShortcut, mac)
      let row: HTMLElement | undefined
      let timer: number | undefined
      let tracker: VoiceSilenceTracker | undefined
      let autoTranscribedRow: HTMLElement | undefined
      let disposed = false

      const stopMonitor = (): void => {
        if (timer !== undefined) window.clearInterval(timer)
        timer = undefined
        row = undefined
        tracker = undefined
      }

      const sample = (): void => {
        const active = row
        if (active === undefined || !active.isConnected || active.dataset.voiceActivity !== 'recording') {
          stopMonitor()
          return
        }
        const level = voiceWaveformRms(active)
        if (level === undefined) return // A changed upstream waveform must not trigger a false timeout.
        const now = performance.now()
        tracker ??= new VoiceSilenceTracker(
          now,
          config.voiceNoSpeechSeconds * 1000,
          config.voiceAfterSpeechSeconds * 1000,
        )
        const decision = tracker.sample(level, now)
        if (decision === 'continue') return
        stopMonitor()
        if (decision === 'cancel') {
          cancelVoiceRecording(active)
        } else {
          autoTranscribedRow = stopVoiceRecording(active) ? active : undefined
        }
      }

      const sync = (): void => {
        if (disposed) return
        const recording = config.voiceAutoStopEnabled ? voiceRow('recording') ?? undefined : undefined
        if (recording !== row) {
          stopMonitor()
          if (recording !== undefined) {
            row = recording
            timer = window.setInterval(sample, SAMPLE_INTERVAL_MS)
            sample()
          }
        }
        if (autoTranscribedRow !== undefined) {
          const pending = autoTranscribedRow
          if (!pending.isConnected || pending.dataset.voiceActivity === 'idle') {
            autoTranscribedRow = undefined
          } else if (pending.dataset.voiceActivity === 'feedback') {
            const state = voiceFeedbackState(pending)
            if (state === 'empty') cancelVoiceRecording(pending)
            if (state !== 'pending') autoTranscribedRow = undefined
          }
        }
      }

      const onKeyDown = (event: KeyboardEvent): void => {
        if (!config.voiceShortcutEnabled || !matchesVoiceShortcut(event, shortcut, mac) || visibleDialog()) return
        const recording = voiceRow('recording')
        const requesting = voiceRow('requesting')
        const feedback = voiceRow('feedback')
        const handled = recording !== null
          ? stopVoiceRecording(recording)
          : requesting !== null
            ? cancelVoiceRecording(requesting)
            : feedback !== null
              ? cancelVoiceRecording(feedback)
              : startVoiceRecording()
        if (handled) {
          event.preventDefault()
          event.stopPropagation()
        }
      }

      const observer = new MutationObserver(sync)
      const mount = (): void => {
        if (disposed || document.body === null) return
        observer.observe(document.body, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['data-voice-activity'],
        })
        sync()
      }
      if (document.body === null) document.addEventListener('DOMContentLoaded', mount, { once: true })
      else mount()
      document.addEventListener('keydown', onKeyDown)
      const unsubscribe = scope.subscribe(() => {
        config = { ...DEFAULT_CONFIG, ...scope.getSnapshot().value }
        shortcut = resolveVoiceShortcut(config.voiceShortcut, mac)
        if (!config.voiceAutoStopEnabled) autoTranscribedRow = undefined
        sync()
      })

      return () => {
        disposed = true
        unsubscribe()
        document.removeEventListener('DOMContentLoaded', mount)
        document.removeEventListener('keydown', onKeyDown)
        observer.disconnect()
        stopMonitor()
        autoTranscribedRow = undefined
      }
    },
  }
}
