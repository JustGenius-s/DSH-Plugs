import { describe, expect, it } from 'vitest'
import { VoiceSilenceTracker } from '../src/client/features/voice-input/silence'

describe('voice silence decisions', () => {
  it('cancels after initial silence without treating a single click as speech', () => {
    const tracker = new VoiceSilenceTracker(0, 8000, 2500)
    expect(tracker.sample(0.06, 100)).toBe('continue')
    expect(tracker.sample(0, 200)).toBe('continue')
    expect(tracker.sample(0.005, 7999)).toBe('continue')
    expect(tracker.sample(0.005, 8000)).toBe('cancel')
  })

  it('transcribes only after sustained speech followed by silence', () => {
    const tracker = new VoiceSilenceTracker(0, 8000, 2500)
    expect(tracker.sample(0.04, 1000)).toBe('continue')
    expect(tracker.sample(0.05, 1200)).toBe('continue')
    expect(tracker.sample(0.05, 5000)).toBe('continue')
    expect(tracker.sample(0, 7499)).toBe('continue')
    expect(tracker.sample(0, 7500)).toBe('transcribe')
  })

  it('resets the silence timer when speech resumes', () => {
    const tracker = new VoiceSilenceTracker(0, 8000, 2500)
    tracker.sample(0.04, 0)
    tracker.sample(0.04, 200)
    expect(tracker.sample(0, 2600)).toBe('continue')
    expect(tracker.sample(0.05, 2700)).toBe('continue')
    expect(tracker.sample(0, 5199)).toBe('continue')
    expect(tracker.sample(0, 5200)).toBe('transcribe')
  })

  it('does not make another decision after automatic completion', () => {
    const tracker = new VoiceSilenceTracker(0, 8000, 2500)
    expect(tracker.sample(0, 8000)).toBe('cancel')
    expect(tracker.sample(0, 10_000)).toBe('continue')
  })
})
