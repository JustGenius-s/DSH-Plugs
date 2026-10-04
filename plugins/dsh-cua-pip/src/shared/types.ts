// Types shared by the host routes and the browser surfaces (native overlay,
// in-page float). This module is bundled into the client, so it must stay
// dependency-free — no Node imports here.

export interface CuaWindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface CuaWindow {
  pid: number
  windowId: number
  appName: string
  title: string
  bounds: CuaWindowBounds
  isOnScreen: boolean
}

export interface WatchTarget {
  pid: number
  windowId: number
}

export interface WindowSize {
  width: number
  height: number
}

export interface CaptureHealth {
  status: 'starting' | 'complete' | 'idle' | 'blank' | 'suspended'
  /** Time the host received a native stream heartbeat, not a fresh frame. */
  checkedAt: number
  /** Last native sample callback; a repeated heartbeat never advances it. */
  sampleAt?: number
}

export interface Frame {
  mime: string
  base64: string
  width: number
  height: number
  appName: string
  windowTitle: string
  /** Native window geometry in OS logical units, not thumbnail pixels. */
  windowBounds?: CuaWindowBounds
  /** Native sample arrival time; cached/static frames keep their original time. */
  capturedAt?: number
  /** Identity of an actual native sample, not a polling request. */
  frameId?: string
  /** Content identity; a new sample can still contain unchanged pixels. */
  imageHash?: string
}

export interface CaptureLifecycle {
  phase: 'starting' | 'ready' | 'recovering' | 'paused' | 'failed'
  generation: number
  retryCount: number
  nextRetryAt: number | null
  errorCode: string | null
}

export interface RecordingStatus {
  state: 'closed' | 'starting' | 'ready' | 'recovering' | 'stale' | 'suspended' | 'stopped' | 'failed'
  ready: boolean
  generation: number
  retryCount: number
  nextRetryAt: number | null
  errorCode: string | null
}

/** Host watcher state as returned by the /cua-pip routes. */
export interface WatcherSnapshot {
  sessionId: string
  target: WatchTarget
  frames: number
  updatedAt: number
  lastFetchAt: number
  error: string | null
  frame: Frame | null
  captureHealth?: CaptureHealth
  captureLifecycle?: CaptureLifecycle
}

export interface WindowsResponse {
  windows: CuaWindow[]
}

export interface FrameResponse {
  ok: boolean
  watching: boolean
  state?: WatcherSnapshot
}

/** A preview is opened explicitly by the agent; tool activity never opens it. */
export interface CuaActivity {
  sessionId: string
  active: boolean
  visible?: boolean
  openedAt?: number
  /** Actual host close time in Unix milliseconds; absent while open or before first open. */
  closedAt?: number
  closeAt?: number
  error?: string
  windowBounds?: CuaWindowBounds
  /** Requested floating preview size in CSS pixels, fitted to the conversation. */
  previewSize?: WindowSize
  tool: string | null
  target: WatchTarget | null
  turn: number
  updatedAt: number
}

export interface ActivityResponse {
  sessions: CuaActivity[]
}
