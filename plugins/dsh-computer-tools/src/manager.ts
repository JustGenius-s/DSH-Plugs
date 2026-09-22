import type { PluginProfileApplyResult, PluginProfileSnapshot } from '@just-genius/dsh-plugin-runtime'
import {
  blockingUnmanaged,
  desiredEntries,
  enabledCapabilities,
  formatInstallCommand,
  inferDesired,
  installPlan,
  missingPackages,
  normalizeDesired,
  packageSpec,
  parseDesired,
  unmanagedOfficial,
  validateDesired,
} from './catalog.ts'
import {
  CUA_DRIVER_APP,
  chromeCandidates,
  commandOnPath,
  firstExisting,
  resolveCuaCommand,
} from './diagnose.ts'
import { ownedFromDesired, type Ledger } from './ledger.ts'
import { probeCuaDriver, restartCuaDriver, type CuaDriverInfo, type RestartOutcome } from './cua-driver.ts'
import { applyDesiredPatch, parsePatchEntries } from './patch.ts'
import { collectDiagnostics, deriveCapability, needsRestartFlag, type LoaderRow } from './status.ts'
import {
  CARD_PACKAGES,
  IDS,
  PACKAGES,
  type ApplyResult,
  type CapabilityCard,
  type DesiredState,
  type Diagnostic,
  type DriverView,
  type InstallResult,
  type MutateRequest,
  type StatusPayload,
  type ToolchainHealth,
} from './shared.ts'

type ApplyFailure = Extract<ApplyResult, { ok: false }>

export interface ComputerToolsPorts {
  snapshot(): PluginProfileSnapshot
  reconcile(input: {
    dependencies: Readonly<Record<string, string>>
    patchText: string
    expectedModifiedAt?: number | null
  }): Promise<PluginProfileApplyResult>
  /** Profile-level package install; the only writer of profile dependencies. */
  install(spec: string): Promise<{ detail: string; needsRestart: boolean }>
  /** Probe the external Cua Driver: permissions + whether its daemon runs. */
  probeDriver(command: string): Promise<CuaDriverInfo>
  probeToolchain?(): Promise<ToolchainHealth>
  /** Restart the driver daemon so it re-reads TCC grants made after it started. */
  restartDriver(command: string): Promise<RestartOutcome>
  /** Sleep hook; injectable so tests do not pay real restart settling time. */
  wait(ms: number): Promise<void>
  loaderRows(): LoaderRow[]
  pathExists(path: string): boolean
  dshBin(): string
  now(): number
  hostStartedAt: number
  platform: NodeJS.Platform
  pathEnv: string
  readLedger(): Ledger
  writeLedger(ledger: Ledger): void
}

export class ComputerToolsManager {
  constructor(private readonly ports: ComputerToolsPorts) {}

  async status(): Promise<StatusPayload> {
    const snapshot = this.ports.snapshot()
    const ledger = this.ports.readLedger()
    const entries = parsePatchEntries(snapshot.patchText)
    const current = inferDesired(entries)
    const missing = missingPackages(current, snapshot.dependencies)
    const input = {
      desired: current,
      dependencies: snapshot.dependencies,
      loader: this.ports.loaderRows(),
      versions: Object.fromEntries(
        Object.entries(snapshot.dependencies).map(([name, spec]) => [name, spec]),
      ),
      lastAppliedAt: ledger.lastAppliedAt,
      hostStartedAt: this.ports.hostStartedAt,
      pathExists: this.ports.pathExists,
      runtimeVersion: runtimeVersionOf(snapshot.dependencies),
    }
    const browser = deriveCapability('browser', input)
    const computer = deriveCapability('computer', input)
    const diagnostics = collectDiagnostics(input)
    const cuaCommand = resolveCuaCommand({ pathEnv: this.ports.pathEnv, pathExists: this.ports.pathExists })
    if (current.computer.enabled && this.ports.platform === 'darwin') {
      if (!this.ports.pathExists(CUA_DRIVER_APP)) {
        diagnostics.push({ id: 'cua-driver-app', level: 'warn', detail: CUA_DRIVER_APP })
      }
      if (current.computer.provider === 'cua-mcp' && !commandOnPath(current.computer.command, this.ports.pathEnv, this.ports.pathExists)) {
        diagnostics.push({ id: 'cua-driver-bin', level: 'warn', detail: current.computer.command })
      }
    }
    const driver = await this.driverView(current, cuaCommand, diagnostics)
    if (computer.phase === 'active' && driver.toolchain !== undefined && driver.toolchain.state !== 'ready') {
      computer.phase = 'failed'
    }
    return {
      modifiedAt: snapshot.modifiedAt,
      needsRestart: needsRestartFlag(ledger.lastAppliedAt, this.ports.hostStartedAt, [browser, computer]),
      runtimeVersion: input.runtimeVersion,
      browser,
      computer,
      current,
      installCommand: missing.length === 0 ? null : formatInstallCommand(this.ports.dshBin(), missing),
      dshBin: this.ports.dshBin(),
      diagnostics,
      driver,
      managedIds: [IDS.browserUse, IDS.playwright, IDS.computerUse, IDS.cuaNative, IDS.cuaMcp],
      unmanaged: unmanagedOfficial(entries),
      installedPackages: Object.keys(snapshot.dependencies),
      defaults: {
        chromePath: firstExisting(chromeCandidates(this.ports.platform), this.ports.pathExists),
        cuaCommand,
      },
    }
  }

  preview(request: MutateRequest): ApplyResult {
    const prepared = this.prepare(request)
    if (!prepared.ok) return prepared
    return {
      ok: true,
      previewPatch: prepared.nextPatch,
      unmanaged: prepared.unmanaged,
      missing: prepared.missing,
    }
  }

  async apply(request: MutateRequest): Promise<ApplyResult> {
    const prepared = this.prepare(request)
    if (!prepared.ok) return prepared
    return await this.commit(prepared.nextPatch, prepared.desired, prepared.snapshot)
  }

  /**
   * Install the packages one card needs. The caller names a card, never a
   * package: the host derives the spec list from `CARD_PACKAGES` plus the
   * requested draft, so a hand-rolled request cannot install arbitrary code.
   */
  async install(card: CapabilityCard, desiredInput?: DesiredState): Promise<InstallResult> {
    const snapshot = this.ports.snapshot()
    const desired = desiredInput ?? inferDesired(parsePatchEntries(snapshot.patchText))
    const plan = installPlan(card, desired, snapshot.dependencies)
    if (plan.length === 0) return { ok: true, installed: [], added: [], needsRestart: false }
    const added: string[] = []
    try {
      for (const name of plan) {
        await this.ports.install(packageSpec(name))
        added.push(name)
      }
    } catch (error) {
      return {
        ok: false,
        installed: plan,
        added,
        message: error instanceof Error ? error.message : String(error),
      }
    }
    return { ok: true, installed: plan, added, needsRestart: true }
  }

  /**
   * Probe the driver only when Computer Use is on and uses the MCP provider —
   * the two cases where its answer can change what the user should do. A probe
   * failure becomes a diagnostic instead of an exception.
   */
  private async driverView(
    current: DesiredState,
    cuaCommand: string,
    diagnostics: Diagnostic[],
  ): Promise<DriverView> {
    if (!current.computer.enabled || current.computer.provider !== 'cua-mcp') {
      return { permissions: null, running: false, pid: null, error: null }
    }
    const info = await this.ports.probeDriver(current.computer.command || cuaCommand)
    const toolchain = await this.ports.probeToolchain?.()
    if (toolchain !== undefined && toolchain.state !== 'ready') {
      diagnostics.push({ id: 'cua-toolchain', level: 'error', detail: toolchain.error ?? toolchain.state })
    }
    if (info.error !== null) {
      diagnostics.push({ id: 'cua-driver-probe', level: 'warn', detail: info.error })
    }
    if (info.permissions !== null) {
      const denied = [
        info.permissions.accessibility === 'denied' ? 'accessibility' : null,
        info.permissions.screenRecording === 'denied' ? 'screen-recording' : null,
      ].filter((id): id is string => id !== null)
      for (const id of denied) {
        diagnostics.push({ id: `cua-permission-${id}`, level: 'error', detail: 'denied' })
      }
    }
    return {
      permissions: info.permissions === null
        ? null
        : {
          accessibility: info.permissions.accessibility,
          screenRecording: info.permissions.screenRecording,
          directCapture: info.permissions.directCapture,
          bundleId: info.permissions.bundleId,
        },
      running: info.running,
      pid: info.pid,
      error: info.error,
      ...(toolchain === undefined ? {} : { toolchain }),
    }
  }

  /** Restart the driver daemon, then report the freshly read permission state. */
  async restartDriver(): Promise<ApplyResult> {
    const cuaCommand = resolveCuaCommand({ pathEnv: this.ports.pathEnv, pathExists: this.ports.pathExists })
    const outcome = await this.ports.restartDriver(cuaCommand)
    if (!outcome.ok) {
      return { ok: false, code: 'io', message: outcome.error ?? 'restart failed' }
    }
    // Give the daemon a beat to bind, so the returned status reflects it.
    await this.ports.wait(1500)
    return { ok: true, status: await this.status() }
  }

  private prepare(request: MutateRequest): Prepared | ApplyFailure {
    const desired = normalizeDesired(request.desired)
    const invalid = validateDesired(desired)
    if (invalid !== null) return { ok: false, code: 'invalid', message: invalid }

    const snapshot = this.ports.snapshot()
    if (casMismatch(snapshot.modifiedAt, request.expectedModifiedAt)) {
      return { ok: false, code: 'profile-changed', message: 'profile changed since it was loaded' }
    }

    const entries = parsePatchEntries(snapshot.patchText)
    const unmanaged = blockingUnmanaged(unmanagedOfficial(entries), desired)
    if (unmanaged.length > 0 && request.takeover !== true) {
      return { ok: false, code: 'takeover-required', message: 'foreign providers present', unmanaged }
    }

    const missing = missingPackages(desired, snapshot.dependencies)
    if (missing.length > 0) {
      return {
        ok: false,
        code: 'missing-packages',
        message: 'required packages are not installed',
        missing,
        installCommand: formatInstallCommand(this.ports.dshBin(), missing),
      }
    }

    const nextPatch = applyDesiredPatch(snapshot.patchText, desiredEntries(desired), {
      removeForeign: request.takeover === true || unmanaged.length > 0,
      capabilities: enabledCapabilities(desired),
    })
    return {
      ok: true,
      desired,
      snapshot,
      nextPatch,
      unmanaged,
      missing,
    }
  }

  private async commit(
    nextPatch: string,
    desired: DesiredState,
    snapshot: PluginProfileSnapshot,
  ): Promise<ApplyResult> {
    try {
      const result = await this.ports.reconcile({
        dependencies: snapshot.dependencies,
        patchText: nextPatch,
        expectedModifiedAt: snapshot.modifiedAt,
      })
      const owned = ownedFromDesired(desired)
      const lastAppliedAt = this.ports.now()
      const nextLedger: Ledger = {
        version: 1,
        owned,
        lastAppliedAt,
        lastDesired: owned ? desired : null,
      }
      this.ports.writeLedger(nextLedger)
      return {
        ok: true,
        needsRestart: result.needsRestart || lastAppliedAt > this.ports.hostStartedAt,
        status: await this.status(),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('profile changed since it was loaded')) {
        return { ok: false, code: 'profile-changed', message }
      }
      return { ok: false, code: 'io', message }
    }
  }
}

export function parseMutateRequest(body: unknown): MutateRequest | null {
  if (body === null || typeof body !== 'object') return null
  const record = body as { desired?: unknown; expectedModifiedAt?: unknown; takeover?: unknown }
  const desired = parseDesired(record.desired)
  if (desired === null) return null
  const expectedModifiedAt = record.expectedModifiedAt === null || record.expectedModifiedAt === undefined
    ? null
    : typeof record.expectedModifiedAt === 'number'
      ? record.expectedModifiedAt
      : null
  if (record.expectedModifiedAt !== undefined && record.expectedModifiedAt !== null && typeof record.expectedModifiedAt !== 'number') {
    return null
  }
  return {
    desired,
    expectedModifiedAt,
    takeover: record.takeover === true,
  }
}

export function parseInstallRequest(body: unknown): { card: CapabilityCard; desired?: DesiredState } | null {
  if (body === null || typeof body !== 'object') return null
  const record = body as { card?: unknown; desired?: unknown }
  if (!isCapabilityCard(record.card)) return null
  if (record.desired === undefined) return { card: record.card }
  const desired = parseDesired(record.desired)
  if (desired === null) return null
  return { card: record.card, desired }
}

export function isCapabilityCard(value: unknown): value is CapabilityCard {
  return typeof value === 'string' && Object.hasOwn(CARD_PACKAGES, value)
}

function casMismatch(current: number | null, expected: number | null | undefined): boolean {
  return expected !== undefined && expected !== current
}

function runtimeVersionOf(dependencies: Readonly<Record<string, string>>): string | null {
  return dependencies[PACKAGES.browserUse]
    ?? dependencies[PACKAGES.computerUse]
    ?? process.env.DSH_VERSION
    ?? null
}

type Prepared = {
  ok: true
  desired: DesiredState
  snapshot: PluginProfileSnapshot
  nextPatch: string
  unmanaged: ReturnType<typeof blockingUnmanaged>
  missing: string[]
}
