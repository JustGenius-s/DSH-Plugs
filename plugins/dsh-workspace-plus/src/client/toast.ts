/**
 * Transient feedback for actions that have no other visible outcome.
 *
 * A tiny store rather than component state: the actions run from several
 * registrations (the injected workspace menu, the official Session menu slot),
 * and each needs to raise a message without owning a React tree.
 */

import type { WorkspacePlusKey } from './locales.ts'

export interface ToastRecord {
  id: number
  key: WorkspacePlusKey
  /** Detail appended after the localized label, e.g. a Host failure message. */
  detail?: string
}

let current: ToastRecord | null = null
let nextId = 1
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function subscribeToast(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getToast(): ToastRecord | null {
  return current
}

export function showToast(key: WorkspacePlusKey, detail?: string): void {
  current = { id: nextId++, key, ...(detail === undefined ? {} : { detail }) }
  emit()
}

export function dismissToast(): void {
  if (current === null) return
  current = null
  emit()
}

/**
 * Drop any current notice because its HOST is going away.
 *
 * Distinct from `dismissToast`, which runs when a notice expires or is replaced,
 * and distinct again from a component unmounting: the store is module-level, so
 * it outlives every React tree that reads it. Without this, a notice raised just
 * before the surface unmounted (a plugin reload, a settings change that hides the
 * panel, switching workspace) stays in the store and is re-shown by the next
 * mount — a message about something the user did in a previous life.
 *
 * Callers use it from an unmount cleanup, so it must be safe to call when nothing
 * is showing: it is then a no-op that does not notify anyone.
 */
export function clearToastOnUnmount(): void {
  if (current === null) return
  current = null
  emit()
}
