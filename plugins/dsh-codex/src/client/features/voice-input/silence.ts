/** The official voice waveform renders its measured microphone RMS, not STT text. */
export const SPEECH_RMS_THRESHOLD = 0.015
export const MIN_SPEECH_MS = 200

export type SilenceDecision = 'continue' | 'cancel' | 'transcribe'

/** Keep a little hysteresis so a click, breath, or one loud sample is not speech. */
export class VoiceSilenceTracker {
  private candidateSince: number | undefined
  private lastSpeechAt: number | undefined
  private decided = false

  constructor(
    private readonly startedAt: number,
    private readonly noSpeechMs: number,
    private readonly afterSpeechMs: number,
  ) {}

  sample(level: number, now: number): SilenceDecision {
    if (this.decided || !Number.isFinite(level)) return 'continue'

    if (level >= SPEECH_RMS_THRESHOLD) {
      this.candidateSince ??= now
      if (this.lastSpeechAt !== undefined || now - this.candidateSince >= MIN_SPEECH_MS) {
        this.lastSpeechAt = now
      }
    } else {
      this.candidateSince = undefined
    }

    if (this.lastSpeechAt !== undefined && now - this.lastSpeechAt >= this.afterSpeechMs) {
      this.decided = true
      return 'transcribe'
    }
    if (this.lastSpeechAt === undefined && now - this.startedAt >= this.noSpeechMs) {
      this.decided = true
      return 'cancel'
    }
    return 'continue'
  }
}
