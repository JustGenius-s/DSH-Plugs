import { TURN_COMPLETED_MS } from './activity.ts'

export const TRANSIENT_MS = 1500
export const WAKE_MS = 3000
export const JOY_MS = 1600
export const ROUND_CELEBRATE_MS = TURN_COMPLETED_MS
export const DRAG_RELEASE_MS = 1500

export const STATE_NAMES = Object.freeze([
  'idle', 'working', 'celebrate', 'error', 'disappointed', 'joy', 'eat', 'play',
  'drag', 'walk', 'sleep', 'wake', 'welcome', 'think', 'wait',
] as const)

export type StateName = (typeof STATE_NAMES)[number]

export const PLAYBACK_MODES = Object.freeze(['loop', 'pingpong', 'once', 'blink'] as const)

export const WORKING_MIN_WAIT_MS = 12_000
export const WORKING_MAX_WAIT_MS = 30_000
export const WORKING_MIN_DUR_MS = 2500
export const WORKING_MAX_DUR_MS = 6000
export const BLINK_MIN_INTERVAL_MS = 3000
export const BLINK_MAX_INTERVAL_MS = 9000
export const FACING_MIN_INTERVAL_MS = 10_000
export const FACING_MAX_INTERVAL_MS = 25_000

export interface ActivitySnapshot {
  name: string
  until: number
  sessionThink?: boolean
  sessionWait?: boolean
  turnCompleted?: boolean
  turnCompletedUntil?: number
}

export interface PickStateInput {
  activity: ActivitySnapshot
  dragging: boolean
  walking?: boolean
  transient: string | null
  sleeping: boolean
  joyUntil: number
  now?: number
  sessionThink?: boolean
  sessionWait?: boolean
  dragReleaseUntil?: number
  workingActive?: boolean
  celebrateUntil?: number
}

interface PickCtx extends Required<Omit<PickStateInput, 'now' | 'walking'>> {
  now: number
  walking: boolean
}

const STATE_TABLE: Array<{
  state: string
  when: (c: PickCtx) => boolean
  resolve?: (c: PickCtx) => string
}> = [
  { state: 'drag', when: (c) => c.dragging },
  { state: 'idle', when: (c) => c.dragReleaseUntil > c.now },
  { state: 'burst', when: (c) => c.activity.name !== 'idle' && c.activity.name !== 'working' && c.activity.until > c.now, resolve: (c) => c.activity.name },
  { state: 'eat', when: (c) => c.transient === 'eat' },
  { state: 'play', when: (c) => c.transient === 'play' },
  { state: 'wake', when: (c) => c.transient === 'wake' },
  { state: 'wait', when: (c) => c.sessionWait },
  { state: 'celebrate', when: (c) => c.celebrateUntil > c.now },
  { state: 'working', when: (c) => c.workingActive },
  { state: 'think', when: (c) => c.sessionThink },
  { state: 'joy', when: (c) => c.now < c.joyUntil },
  { state: 'sleep', when: (c) => c.sleeping },
  { state: 'walk', when: (c) => c.walking },
  { state: 'idle', when: () => true },
]

export function pickState(input: PickStateInput): string {
  const ctx: PickCtx = {
    ...input,
    now: input.now ?? Date.now(),
    joyUntil: input.joyUntil ?? 0,
    sessionThink: input.sessionThink ?? false,
    sessionWait: input.sessionWait ?? false,
    dragReleaseUntil: input.dragReleaseUntil ?? 0,
    workingActive: input.workingActive ?? false,
    celebrateUntil: input.celebrateUntil ?? 0,
    walking: input.walking ?? false,
  }
  for (const row of STATE_TABLE) {
    if (row.when(ctx)) return row.resolve ? row.resolve(ctx) : row.state
  }
  return 'idle'
}

export function nextBlinkAt({ now, random = Math.random }: { now: number; random?: () => number }): number {
  return now + BLINK_MIN_INTERVAL_MS + random() * (BLINK_MAX_INTERVAL_MS - BLINK_MIN_INTERVAL_MS)
}

export function nextFacingAt({ now, random = Math.random }: { now: number; random?: () => number }): number {
  return now + FACING_MIN_INTERVAL_MS + random() * (FACING_MAX_INTERVAL_MS - FACING_MIN_INTERVAL_MS)
}

export function nextWorkingRhythm(input: {
  now: number
  sessionThink: boolean
  working: { active: boolean; until: number }
  random?: () => number
}): { active: boolean; until: number } {
  const random = input.random ?? Math.random
  if (!input.sessionThink) return { active: false, until: 0 }
  if (input.working.active) {
    const dur = WORKING_MIN_DUR_MS + random() * (WORKING_MAX_DUR_MS - WORKING_MIN_DUR_MS)
    return { active: false, until: input.now + dur }
  }
  const wait = WORKING_MIN_WAIT_MS + random() * (WORKING_MAX_WAIT_MS - WORKING_MIN_WAIT_MS)
  return { active: true, until: input.now + wait }
}

export function shouldWake(prevState: string, nextState: string, ctx: { dragging?: boolean; transient?: string | null } = {}): boolean {
  return prevState === 'sleep' && nextState !== 'sleep' && !ctx.dragging && (ctx.transient ?? null) === null
}

export function wakeFromInteraction({ sleeping }: { sleeping: boolean }): { sleeping: boolean; wake: boolean } {
  return { sleeping: false, wake: sleeping === true }
}

export const DEFAULT_ROLE_ID = 'whale-girl'
export const ROLE_ID_RE = /^[a-z0-9-]+$/

export interface Character {
  id: string
  name: string
  credit?: string
  meta: Record<string, unknown>
  states: Record<string, StateAnim>
}

export interface StateAnim {
  sheet: string
  frames: number
  fps: number
  playback?: string
  motion?: string
}

export function parseCharacters(manifest: unknown): { characters: Record<string, Character>; defaultId: string } {
  const raw = (manifest as { characters?: unknown } | null)?.characters
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const characters: Record<string, Character> = {}
    for (const [id, ch] of Object.entries(raw as Record<string, unknown>)) {
      if (ch === null || typeof ch !== 'object') continue
      const obj = ch as Record<string, unknown>
      characters[id] = {
        id,
        name: typeof obj.name === 'string' ? obj.name : id,
        credit: typeof obj.credit === 'string' ? obj.credit : undefined,
        meta: obj.meta !== null && typeof obj.meta === 'object' ? obj.meta as Record<string, unknown> : {},
        states: obj.states !== null && typeof obj.states === 'object' ? obj.states as Record<string, StateAnim> : {},
      }
    }
    const defaultId = typeof (manifest as { default?: unknown }).default === 'string'
      && (manifest as { default: string }).default in characters
      ? (manifest as { default: string }).default
      : Object.keys(characters)[0] ?? DEFAULT_ROLE_ID
    return { characters, defaultId }
  }
  return {
    characters: {
      [DEFAULT_ROLE_ID]: {
        id: DEFAULT_ROLE_ID,
        name: DEFAULT_ROLE_ID,
        credit: undefined,
        meta: {},
        states: (manifest as { states?: Record<string, StateAnim> } | null)?.states ?? {},
      },
    },
    defaultId: DEFAULT_ROLE_ID,
  }
}

export function getCharacter(manifest: unknown, id: string): Character | null {
  return parseCharacters(manifest).characters[id] ?? null
}

export function listCharacters(manifest: unknown): string[] {
  return Object.keys(parseCharacters(manifest).characters)
}

export function stateOf(character: Character | null, stateName: string): StateAnim | undefined {
  return character?.states?.[stateName]
}
