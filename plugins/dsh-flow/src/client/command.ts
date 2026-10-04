import type { InputTriggerSource } from '@just-genius/dsh-plugin-runtime/client'
import { IconFlowOutline16 } from '@just-genius/dsh-plugin-ui'
import { FLOW_COMMAND } from '../shared.ts'
import type { FlowKey } from './locales.ts'

type Translate = (key: FlowKey) => string
type Session = { sessionId: string }
type SubmitOutcome = { kind: 'success' | 'error'; text?: string }

export interface FlowCommand {
  name: string
  label(): string
  description(): string
  icon: typeof IconFlowOutline16
  available(): boolean
  ui: { kind: 'action'; run(session: Session): void }
}

/** Client ownership lets the command menu localize its title and display a glyph. */
export function createFlowCommand(t: Translate, run: (session: Session) => void): FlowCommand {
  return {
    name: FLOW_COMMAND,
    label: () => t('command.label'),
    description: () => t('command.description'),
    icon: IconFlowOutline16,
    available: () => true,
    ui: { kind: 'action', run },
  }
}

/**
 * The command menu owns bare /flow. This source handles typed arguments and
 * the Chinese spelling without contributing another menu row.
 */
export function createFlowArgumentSource(
  t: Translate,
  submit: (sessionId: string, rawInput: string) => Promise<SubmitOutcome>,
): InputTriggerSource {
  const matches = (token: string) => token === `/${FLOW_COMMAND}` || token === '/流程'
  const claim = (session: Session, token: string) => ({
    name: FLOW_COMMAND,
    token: `${token} `,
    hint: t('command.hint'),
    submit: (args: string) => submit(String(session.sessionId), args),
  })
  return {
    trigger: '/',
    name: 'flow-arguments',
    candidates: async () => [],
    onPick: () => undefined,
    matchSpace: (session, token) => matches(token) ? { claim: claim(session, token) } : undefined,
    async matchEnter(session, line, _signal, envelope) {
      const token = line.trim().split(/\s/, 1)[0]!
      if (!matches(token)) return undefined
      // The bare canonical command belongs to commandUi's immediate action.
      if (line.trim() === `/${FLOW_COMMAND}`) return undefined
      // Older SDKs call this field images; current hosts count all attachments.
      const { attachments = 0, images = 0 } = envelope as { attachments?: number; images?: number }
      if (attachments > 0 || images > 0) throw new Error(t('command.attachmentsUnsupported'))
      return { claim: claim(session, token) }
    },
  }
}
