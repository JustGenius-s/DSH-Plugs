import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { type DesiredState } from './shared.ts'
import { normalizeDesired } from './catalog.ts'

export interface Ledger {
  version: 1
  owned: boolean
  lastAppliedAt: number | null
  lastDesired: DesiredState | null
}

export const EMPTY_LEDGER: Ledger = {
  version: 1,
  owned: false,
  lastAppliedAt: null,
  lastDesired: null,
}

export function ledgerDir(home = process.env.DSH_HOME || join(homedir(), '.dsh')): string {
  return join(home, 'computer-tools')
}

export function ledgerPath(home?: string): string {
  return join(ledgerDir(home), 'ledger.json')
}

export function readLedger(path = ledgerPath()): Ledger {
  if (!existsSync(path)) return { ...EMPTY_LEDGER }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<Ledger>
    return {
      version: 1,
      owned: raw.owned === true,
      lastAppliedAt: typeof raw.lastAppliedAt === 'number' ? raw.lastAppliedAt : null,
      lastDesired: raw.lastDesired == null ? null : normalizeDesired(raw.lastDesired),
    }
  } catch {
    return { ...EMPTY_LEDGER }
  }
}

export function writeLedger(ledger: Ledger, path = ledgerPath()): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`)
}

export function ownedFromDesired(desired: DesiredState): boolean {
  return desired.browser.enabled || desired.computer.enabled
}
