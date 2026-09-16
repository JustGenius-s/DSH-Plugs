/** Effective debug stance: a queued switch wins over the last committed value. */
export function effectiveDebugOn(wanted: boolean | null | undefined, logged: boolean): boolean {
  return (wanted ?? logged) === true
}

/** Live log card: hide the empty "Waiting…" shell until evidence arrives. */
export function debugLogCardOpen(input: {
  logCount: number
  runCount: number
  hypothesisCount: number
}): boolean {
  return input.logCount > 0 || input.runCount > 0 || input.hypothesisCount > 0
}

/** Dock seat: mode on, plus either a log card or an open reproduction wait. */
export function debugDockOpen(input: {
  active: boolean
  logCount: number
  runCount: number
  hypothesisCount: number
  waiting: boolean
}): boolean {
  if (!input.active) return false
  return input.waiting || debugLogCardOpen(input)
}
