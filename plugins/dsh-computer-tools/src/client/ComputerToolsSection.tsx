import { useEffect, useState, useSyncExternalStore } from 'react'
import type { InjectFace } from '@just-genius/dsh-plugin-runtime/client'
import {
  Button,
  CardFooter,
  DiscardButton,
  FailureRow,
  Field,
  FieldHead,
  InlineNotice,
  Input,
  PendingBadge,
  RiskConfirmation,
  SaveButton,
  SettingsCard,
  SettingsSection,
  StatusText,
  SwitchField,
  writeClipboard,
} from '@just-genius/dsh-plugin-ui'
import { formatInstallCommand, shortPackageName } from '../catalog.ts'
import type { CapabilityPhase, Diagnostic } from '../shared.ts'
import {
  argsFromText,
  argsToText,
  canSave,
  defaultBrowserDraft,
  defaultComputerDraft,
  needsNativeConfirm,
  type CardKind,
} from '../view-state.ts'
import { DriverStatus } from './DriverStatus.tsx'
import { SelectMenu } from './SelectMenu.tsx'
import type { ComputerToolsKey } from './locales.ts'
import type { ComputerToolsController } from './store.ts'
import styles from './ComputerToolsSection.module.css'

export interface ComputerToolsSectionInjected {
  t: (key: ComputerToolsKey) => string
  controller: ComputerToolsController
}

export type ComputerToolsSectionProps = Partial<InjectFace<ComputerToolsSectionInjected>>

type Translate = (key: ComputerToolsKey) => string
type ConfirmState = { kind: 'native' | 'takeover'; card: CardKind } | null

const BROWSER_DIAG_KEYS: Record<string, ComputerToolsKey> = {
  'browser-executable': 'diagBrowserExecutable',
  'browser-duplicate': 'diagBrowserDuplicate',
}
const COMPUTER_DIAG_KEYS: Record<string, ComputerToolsKey> = {
  'mcp-command': 'diagMcpCommand',
  'computer-duplicate': 'diagComputerDuplicate',
  'cua-driver-app': 'diagCuaApp',
  'cua-driver-bin': 'diagCuaBin',
  'cua-toolchain': 'diagCuaToolchain',
  'cua-driver-probe': 'diagCuaProbe',
}

export function ComputerToolsSection({ t, controller }: ComputerToolsSectionProps) {
  const translate = t ?? ((key: ComputerToolsKey) => key)
  if (controller === undefined) throw new Error('ComputerToolsSection requires ComputerToolsController')
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const { status, draft, load, error, busy, installing, justInstalled } = snapshot
  const dshBin = status?.dshBin ?? 'dsh'
  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [copiedCard, setCopiedCard] = useState<CardKind | null>(null)
  const [browserOpen, setBrowserOpen] = useState(true)
  const [computerOpen, setComputerOpen] = useState(true)

  useEffect(() => {
    void controller.reload()
  }, [controller])

  const submit = async (card: CardKind, takeover: boolean) => {
    if (draft === null || status === null) return
    if (!takeover && card === 'computer' && needsNativeConfirm(draft.computer, status.current.computer)) {
      setConfirm({ kind: 'native', card })
      setAcknowledged(false)
      return
    }
    const result = await controller.saveCard(card, takeover)
    if (!result.ok && result.code === 'takeover-required') {
      setConfirm({ kind: 'takeover', card })
      setAcknowledged(false)
    }
  }

  const confirmAction = async () => {
    const current = confirm
    setConfirm(null)
    setAcknowledged(false)
    if (current === null) return
    if (current.kind === 'native') {
      const result = await controller.saveCard(current.card, false)
      if (!result.ok && result.code === 'takeover-required') {
        setConfirm({ kind: 'takeover', card: current.card })
        setAcknowledged(false)
      }
      return
    }
    await controller.saveCard(current.card, true)
  }

  const copyInstall = (card: CardKind, missing: readonly string[]) => {
    void writeClipboard(formatInstallCommand(dshBin, missing)).then((ok) => {
      if (ok) {
        setCopiedCard(card)
        setTimeout(() => setCopiedCard(null), 1200)
      }
    })
  }

  const installNow = (card: CardKind) => {
    void controller.installCard(card)
  }

  return (
    <SettingsSection busy={load === 'loading' || busy}>
      {load === 'loading' ? <StatusText>{translate('loading')}</StatusText> : null}
      {load === 'error' ? (
        <FailureRow>
          <p role="alert">{error ?? translate('loadFailed')}</p>
          <Button size="sm" variant="outline" onClick={() => void controller.reload()}>
            {translate('retry')}
          </Button>
        </FailureRow>
      ) : null}
      {load === 'ready' && status !== null && draft !== null ? (
        <>
          {status.needsRestart ? (
            <InlineNotice kind="info">
              <span>{translate('restart')}</span>
              {' '}
              <Button size="sm" variant="outline" onClick={() => relaunchIfPossible()}>
                {translate('relaunch')}
              </Button>
            </InlineNotice>
          ) : null}
          {error !== null ? <InlineNotice kind="error" role="alert">{error}</InlineNotice> : null}

          <ul className={styles.cards}>
            <SettingsCard
              title={translate('browser')}
              description={translate('browserPurpose')}
              open={browserOpen}
              onToggle={() => setBrowserOpen((open) => !open)}
              pending={controller.cardDirty('browser')
                ? <PendingBadge>{translate('unsaved')}</PendingBadge>
                : <StatusChip phase={status.browser.phase} translate={translate} />}
            >
              <SwitchField
                id="dsh-computer-tools-browser"
                label={translate('enabled')}
                checked={draft.browser.enabled}
                disabled={busy}
                onChange={(enabled) => controller.setDraft('browser', (next) => {
                  next.browser = enabled
                    ? defaultBrowserDraft(status.defaults.chromePath)
                    : { enabled: false }
                })}
              />
              {draft.browser.enabled ? (
                <>
                  <MissingRow
                    card="browser"
                    missing={controller.cardMissing('browser')}
                    copied={copiedCard === 'browser'}
                    installing={installing === 'browser'}
                    justInstalled={justInstalled === 'browser'}
                    onCopy={copyInstall}
                    onInstall={installNow}
                    onReload={() => void controller.refresh()}
                    translate={translate}
                  />
                  <DiagList items={status.diagnostics} keys={BROWSER_DIAG_KEYS} translate={translate} />
                  <ValidationNote error={controller.cardValidationError('browser')} translate={translate} />
                  <details className={styles.advanced}>
                    <summary>{translate('advanced')}</summary>
                    <div className={styles.fieldStack}>
                      <SelectMenu
                        label={translate('mode')}
                        value={draft.browser.mode}
                        disabled={busy}
                        options={[
                          { value: 'launch', label: translate('launch') },
                          { value: 'attach', label: translate('attach') },
                        ]}
                        onChange={(mode) => controller.setDraft('browser', (next) => {
                          if (!next.browser.enabled) return
                          next.browser.mode = mode === 'attach' ? 'attach' : 'launch'
                        })}
                      />
                      {draft.browser.mode === 'launch' ? (
                        <>
                          <SwitchField
                            id="dsh-computer-tools-headless"
                            label={translate('headless')}
                            checked={draft.browser.headless}
                            disabled={busy}
                            onChange={(headless) => controller.setDraft('browser', (next) => {
                              if (!next.browser.enabled) return
                              next.browser.headless = headless
                            })}
                          />
                          <TextField
                            id="dsh-computer-tools-exe"
                            label={translate('executablePath')}
                            value={draft.browser.executablePath}
                            disabled={busy}
                            onChange={(executablePath) => controller.setDraft('browser', (next) => {
                              if (!next.browser.enabled) return
                              next.browser.executablePath = executablePath
                            })}
                          />
                        </>
                      ) : (
                        <TextField
                          id="dsh-computer-tools-endpoint"
                          label={translate('endpoint')}
                          value={draft.browser.endpoint}
                          disabled={busy}
                          onChange={(endpoint) => controller.setDraft('browser', (next) => {
                            if (!next.browser.enabled) return
                            next.browser.endpoint = endpoint
                          })}
                        />
                      )}
                    </div>
                  </details>
                </>
              ) : null}
              <CardSaveFooter
                card="browser"
                busy={busy}
                installing={installing !== null}
                controller={controller}
                translate={translate}
                onSave={submit}
              />
            </SettingsCard>

            <SettingsCard
              title={translate('computer')}
              description={translate('computerPurpose')}
              open={computerOpen}
              onToggle={() => setComputerOpen((open) => !open)}
              pending={controller.cardDirty('computer')
                ? <PendingBadge>{translate('unsaved')}</PendingBadge>
                : (
                  <StatusChip
                    phase={status.computer.phase}
                    permissionDenied={isPermissionDenied(status.driver)}
                    translate={translate}
                  />
                )}
            >
              <SwitchField
                id="dsh-computer-tools-computer"
                label={translate('enabled')}
                checked={draft.computer.enabled}
                disabled={busy}
                onChange={(enabled) => controller.setDraft('computer', (next) => {
                  next.computer = enabled
                    ? defaultComputerDraft('cua-mcp', status.defaults.cuaCommand)
                    : { enabled: false }
                })}
              />
              {draft.computer.enabled ? (
                <>
                  <MissingRow
                    card="computer"
                    missing={controller.cardMissing('computer')}
                    copied={copiedCard === 'computer'}
                    installing={installing === 'computer'}
                    justInstalled={justInstalled === 'computer'}
                    onCopy={copyInstall}
                    onInstall={installNow}
                    onReload={() => void controller.refresh()}
                    translate={translate}
                  />
                  <DiagList items={status.diagnostics} keys={COMPUTER_DIAG_KEYS} translate={translate} />
                  <ValidationNote error={controller.cardValidationError('computer')} translate={translate} />
                  {draft.computer.provider === 'cua-mcp' ? (
                    <DriverStatus
                      driver={status.driver}
                      translate={translate}
                      busy={busy}
                      restarting={snapshot.restartingDriver}
                      onOpenPrivacy={(pane) => void controller.openPrivacy(pane)}
                      onRestart={() => void controller.restartDriver()}
                      onRefresh={() => void controller.refresh()}
                    />
                  ) : null}
                  <details className={styles.advanced}>
                    <summary>{translate('advanced')}</summary>
                    <div className={styles.fieldStack}>
                      <SelectMenu
                        label={translate('provider')}
                        value={draft.computer.provider}
                        disabled={busy}
                        options={[
                          { value: 'cua-mcp', label: translate('cuaMcp') },
                          { value: 'cua-native', label: translate('cuaNative') },
                        ]}
                        onChange={(provider) => controller.setDraft('computer', (next) => {
                          next.computer = defaultComputerDraft(
                            provider === 'cua-native' ? 'cua-native' : 'cua-mcp',
                            status.defaults.cuaCommand,
                          )
                        })}
                      />
                      {draft.computer.provider === 'cua-mcp' ? (
                        <>
                          <TextField
                            id="dsh-computer-tools-command"
                            label={translate('command')}
                            value={draft.computer.command}
                            disabled={busy}
                            onChange={(command) => controller.setDraft('computer', (next) => {
                              if (!next.computer.enabled || next.computer.provider !== 'cua-mcp') return
                              next.computer.command = command
                            })}
                          />
                          <TextField
                            id="dsh-computer-tools-args"
                            label={translate('args')}
                            value={argsToText(draft.computer.args)}
                            disabled={busy}
                            onChange={(value) => controller.setDraft('computer', (next) => {
                              if (!next.computer.enabled || next.computer.provider !== 'cua-mcp') return
                              next.computer.args = argsFromText(value)
                            })}
                          />
                        </>
                      ) : null}
                    </div>
                  </details>
                </>
              ) : null}
              <CardSaveFooter
                card="computer"
                busy={busy}
                installing={installing !== null}
                controller={controller}
                translate={translate}
                onSave={submit}
              />
            </SettingsCard>
          </ul>
        </>
      ) : null}

      <RiskConfirmation
        open={confirm !== null}
        title={translate(confirm?.kind === 'native' ? 'nativeTitle' : 'takeoverTitle')}
        description={translate(confirm?.kind === 'native' ? 'nativeDescription' : 'takeoverDescription')}
        acknowledgeLabel={translate(confirm?.kind === 'native' ? 'nativeAck' : 'takeoverAck')}
        cancelLabel={translate('cancel')}
        confirmLabel={translate('confirm')}
        acknowledged={acknowledged}
        disabled={busy}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => {
          setConfirm(null)
          setAcknowledged(false)
        }}
        onConfirm={() => void confirmAction()}
      />
    </SettingsSection>
  )
}

function CardSaveFooter(props: {
  card: CardKind
  busy: boolean
  /** A package install is in flight; saving now would race the profile write. */
  installing: boolean
  controller: ComputerToolsController
  translate: Translate
  onSave: (card: CardKind, takeover: boolean) => Promise<void>
}) {
  const { card, busy, controller, translate } = props
  const dirty = controller.cardDirty(card)
  if (!dirty) return null
  const blocked = busy || props.installing
  const saveEnabled = canSave({
    dirty,
    busy: blocked,
    validationError: controller.cardValidationError(card),
    missingPackages: controller.cardMissing(card),
  })
  return (
    <CardFooter>
      <DiscardButton disabled={blocked} onClick={() => controller.discardCard(card)}>
        {translate('discard')}
      </DiscardButton>
      <SaveButton disabled={!saveEnabled} onClick={() => void props.onSave(card, false)}>
        {blocked ? translate('saving') : translate('save')}
      </SaveButton>
    </CardFooter>
  )
}

/**
 * Compact phase chip on the card header, so a collapsed card still says whether
 * the capability works. Hidden when off: an off capability needs no badge.
 */
function StatusChip(props: {
  phase: CapabilityPhase
  permissionDenied?: boolean
  translate: Translate
}) {
  const { phase, translate } = props
  if (phase === 'off' || phase === 'unknown') return null
  // A denied TCC grant outranks the generic phase: that is what blocks the user.
  const key: ComputerToolsKey | null = props.permissionDenied === true
    ? 'permDenied'
    : statusKey(phase)
  if (key === null) return null
  const state = props.permissionDenied === true
    ? 'err'
    : phase === 'active'
      ? 'ok'
      : phase === 'failed'
        ? 'err'
        : 'warn'
  return (
    <span className={styles.chip} data-state={state}>
      <span className={styles.chipDot} />
      {translate(key)}
    </span>
  )
}

/** True when the driver is running but a required TCC grant was refused. */
export function isPermissionDenied(driver: { permissions: { accessibility: string; screenRecording: string } | null }): boolean {
  if (driver.permissions === null) return false
  return driver.permissions.accessibility === 'denied' || driver.permissions.screenRecording === 'denied'
}

function statusKey(phase: CapabilityPhase): ComputerToolsKey | null {
  switch (phase) {
    case 'active': return 'status.active'
    case 'pending-restart': return 'status.pendingRestart'
    case 'configured': return 'status.configured'
    case 'missing-deps': return 'status.missingDeps'
    case 'failed': return 'status.failed'
    case 'unknown': return 'status.unknown'
    default: return null
  }
}

function MissingRow(props: {
  card: CardKind
  missing: readonly string[]
  copied: boolean
  installing: boolean
  justInstalled: boolean
  onCopy: (card: CardKind, missing: readonly string[]) => void
  onInstall: (card: CardKind) => void
  onReload: () => void
  translate: Translate
}) {
  if (props.justInstalled && props.missing.length === 0) {
    return <InlineNotice kind="ok">{props.translate('installedRestart')}</InlineNotice>
  }
  if (props.missing.length === 0) return null
  const names = props.missing.map(shortPackageName).join('、')
  return (
    <InlineNotice kind="info">
      <span>{props.translate('missingPackages')}{names}</span>
      {' '}
      <Button size="sm" variant="primary" disabled={props.installing} onClick={() => props.onInstall(props.card)}>
        {props.installing ? props.translate('installing') : props.translate('installNow')}
      </Button>
      <Button size="sm" variant="outline" onClick={() => props.onCopy(props.card, props.missing)}>
        {props.copied ? props.translate('copied') : props.translate('copyInstall')}
      </Button>
      {props.installing ? null : (
        <Button size="sm" variant="outline" onClick={props.onReload}>
          {props.translate('retry')}
        </Button>
      )}
    </InlineNotice>
  )
}

function DiagList(props: {
  items: readonly Diagnostic[]
  keys: Record<string, ComputerToolsKey>
  translate: Translate
}) {
  const rows = props.items.filter((item) => item.id in props.keys)
  if (rows.length === 0) return null
  return (
    <>
      {rows.map((item) => (
        <p key={item.id} className={styles.diag}>
          {props.translate(props.keys[item.id] as ComputerToolsKey)}{item.detail}
        </p>
      ))}
    </>
  )
}

function ValidationNote(props: { error: string | null; translate: Translate }) {
  if (props.error === null) return null
  const key: ComputerToolsKey = props.error === 'MCP command is required' ? 'invalidCommand' : 'invalidEndpoint'
  return <InlineNotice kind="error" role="alert">{props.translate(key)}</InlineNotice>
}

function TextField(props: {
  id: string
  label: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <Field>
      <FieldHead htmlFor={props.id} label={props.label} />
      <Input
        id={props.id}
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
    </Field>
  )
}

function relaunchIfPossible(): void {
  const desktop = (window as unknown as {
    dshDesktop?: { updates?: { relaunch?: () => void } }
  }).dshDesktop
  desktop?.updates?.relaunch?.()
}
