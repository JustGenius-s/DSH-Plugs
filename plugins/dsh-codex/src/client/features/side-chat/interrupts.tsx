/**
 * Side-chat takeover for host-owned interrupts.
 *
 * The main conversation answers these through the composer chain
 * (`ApprovalPanel` / `QuestionComposer`). Side chat owns its own input bar,
 * so it has to consume `snapshot.pending` itself: approvals first, then
 * `ask_user_question` (including the plan-review presentation).
 */

import { useMemo, useState, type KeyboardEvent } from 'react'
import type {
  PendingInteraction,
  PendingWait,
  RunningToolCall,
} from '@just-genius/dsh-plugin-runtime/client'
import {
  Button,
  IconCheckOutline14,
  IconChevronDownOutline14,
  IconChevronLeftOutline14,
  IconChevronRightOutline14,
  IconChevronUpOutline14,
  IconCloseOutline16,
  IconEditOutline16,
  MarkdownText,
} from '@just-genius/dsh-plugin-ui'

export interface SideChatInterruptProps {
  wait: PendingInteraction
  runningCalls?: readonly RunningToolCall[] | undefined
  t: (key: string) => string
}

/** Pick the interrupt that should occupy the side-chat composer. */
export function pickSideChatWait(
  pending: readonly PendingInteraction[] | undefined,
): PendingInteraction | undefined {
  if (pending === undefined) return undefined
  return pending.find(item => item.kind === 'approval')
    ?? pending.find(item => item.kind === 'question')
}

/** Render the pending approval or question in place of the composer. */
export function SideChatInterrupt({ wait, runningCalls, t }: SideChatInterruptProps) {
  if (wait.kind === 'approval') {
    return <ApprovalCard wait={wait} runningCalls={runningCalls} t={t} />
  }
  return <QuestionCard wait={wait} t={t} />
}

function ApprovalCard({
  wait,
  runningCalls,
  t,
}: {
  wait: PendingWait<'approval'>
  runningCalls?: readonly RunningToolCall[] | undefined
  t: (key: string) => string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const command = commandOf(runningCalls, wait.payload.callId)
  const headline = wait.payload.reason
    ?? t('sideChat.approvalEscalation').replace('{toolName}', String(wait.payload.toolName ?? ''))

  const answer = (outcome: 'allowed-once' | 'rejected'): void => {
    setBusy(true)
    setError(null)
    void wait.respond({
      ok: true,
      value: {
        sessionId: wait.sessionId,
        approvalId: wait.payload.approvalId,
        outcome,
      },
    }).then((receipt) => {
      if (!receipt.accepted) {
        setBusy(false)
        setError(receipt.reason ?? t('sideChat.interruptFailed'))
      }
    }).catch((cause) => {
      setBusy(false)
      setError(cause instanceof Error ? cause.message : t('sideChat.interruptFailed'))
    })
  }

  return (
    <section className="dsh-codex-sidechat-irq dsh-codex-sidechat-irq-warn" data-approval-key={wait.key}>
      <div className="dsh-codex-sidechat-irq-strip">
        <span className="dsh-codex-sidechat-irq-dot" />
        {t('sideChat.approvalWaiting')}
      </div>
      <div className="dsh-codex-sidechat-irq-body">
        <div className="dsh-codex-sidechat-irq-headline">{headline}</div>
        {command !== undefined && (
          <div className="dsh-codex-sidechat-irq-command">{command}</div>
        )}
        {error !== null && <div className="dsh-codex-sidechat-irq-error" role="status">{error}</div>}
      </div>
      <div className="dsh-codex-sidechat-irq-actions">
        <Button variant="outline" size="sm" disabled={busy} className="dsh-codex-sidechat-irq-reject" onClick={() => answer('rejected')}>
          {t('sideChat.approvalReject')}
        </Button>
        <Button variant="primary" size="sm" disabled={busy} onClick={() => answer('allowed-once')}>
          {t('sideChat.approvalAllowOnce')}
        </Button>
      </div>
    </section>
  )
}

function QuestionCard({
  wait,
  t,
}: {
  wait: PendingWait<'question'>
  t: (key: string) => string
}) {
  const questions: readonly QuestionItem[] = (wait.payload.questions ?? []) as readonly QuestionItem[]
  const review = useMemo(() => planReviewOf(questions), [questions])
  if (review !== undefined) {
    return <PlanReviewCard wait={wait} review={review} t={t} />
  }
  return <QuestionFlow wait={wait} questions={questions} t={t} />
}

interface QuestionOption {
  label: string
  description?: string
}

interface QuestionItem {
  id: string
  question: string
  detail?: string
  header?: string
  options?: QuestionOption[]
  multiSelect?: boolean
  intent?: { kind: string; approve?: string }
}

interface PlanReview {
  id: string
  question: string
  plan: string
  approve: QuestionOption
  decline?: QuestionOption
}

interface Draft {
  selected: string[]
  custom: string
  skipped: boolean
}

function PlanReviewCard({
  wait,
  review,
  t,
}: {
  wait: PendingWait<'question'>
  review: PlanReview
  t: (key: string) => string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const settle = (send: () => Promise<void>): void => {
    setBusy(true)
    setError(null)
    void send().catch((cause) => {
      setBusy(false)
      setError(cause instanceof Error ? cause.message : t('sideChat.interruptFailed'))
    })
  }

  const decide = (label: string): void => {
    settle(() => answerQuestion(wait, { answers: [{ id: review.id, selected: [label] }] }))
  }

  return (
    <section className="dsh-codex-sidechat-irq dsh-codex-sidechat-irq-warn" data-plan-review-key={wait.key} aria-label={review.question}>
      <div className="dsh-codex-sidechat-irq-strip">
        <span className="dsh-codex-sidechat-irq-dot" />
        {t('sideChat.planHeader')}
      </div>
      <div className="dsh-codex-sidechat-irq-body dsh-codex-sidechat-irq-scroll">
        <MarkdownText text={review.plan} />
      </div>
      {error !== null && <div className="dsh-codex-sidechat-irq-error" role="status">{error}</div>}
      <div className="dsh-codex-sidechat-irq-actions">
        <Button
          variant="ghost"
          size="sm"
          icon={<IconEditOutline16 size={14} />}
          disabled={busy}
          onClick={() => { settle(() => cancelQuestion(wait)) }}
        >
          {t('sideChat.planDiscuss')}
        </Button>
        {review.decline !== undefined && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            title={review.decline.description}
            onClick={() => {
              const decline = review.decline
              if (decline === undefined) return
              decide(decline.label)
            }}
          >
            {t('sideChat.planDecline')}
          </Button>
        )}
        <Button
          variant="primary"
          size="sm"
          disabled={busy}
          title={review.approve.description}
          onClick={() => decide(review.approve.label)}
        >
          {t('sideChat.planApprove')}
        </Button>
      </div>
    </section>
  )
}

function QuestionFlow({
  wait,
  questions,
  t,
}: {
  wait: PendingWait<'question'>
  questions: readonly QuestionItem[]
  t: (key: string) => string
}) {
  const [index, setIndex] = useState(0)
  const [drafts, setDrafts] = useState<Draft[]>(() => questions.map(() => ({
    selected: [],
    custom: '',
    skipped: false,
  })))
  const [busy, setBusy] = useState<'answer' | 'cancel' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [minimized, setMinimized] = useState(false)

  const question = questions[index]
  const draft = drafts[index]
  if (question === undefined || draft === undefined) return null
  const hasOptions = (question.options?.length ?? 0) > 0

  const updateDraft = (update: (current: Draft) => Draft): void => {
    setDrafts(current => current.map((item, itemIndex) => itemIndex === index ? update(item) : item))
    setError(null)
  }

  const answered = (item: Draft): boolean => item.selected.length > 0 || item.custom.trim() !== ''
  const completed = (item: Draft): boolean => answered(item) || item.skipped

  const choose = (label: string): void => {
    updateDraft((current) => {
      if (question.multiSelect === true) {
        const selected = current.selected.includes(label)
          ? current.selected.filter(item => item !== label)
          : [...current.selected, label]
        return { ...current, selected, skipped: false }
      }
      return { selected: [label], custom: '', skipped: false }
    })
    if (question.multiSelect !== true && index < questions.length - 1) {
      setIndex(current => current + 1)
    }
  }

  const submitDrafts = (values: readonly Draft[]): void => {
    const missing = values.findIndex(item => !completed(item))
    if (missing >= 0) {
      setIndex(missing)
      setError(t('sideChat.questionIncomplete'))
      return
    }
    const answer = {
      answers: questions.map((item, itemIndex) => {
        const value = values[itemIndex] ?? { selected: [], custom: '', skipped: true }
        if (value.skipped) return { id: item.id, selected: [] as string[] }
        const custom = value.custom.trim()
        return {
          id: item.id,
          selected: custom === '' || item.multiSelect === true ? value.selected : [],
          ...(custom === '' ? {} : { custom }),
        }
      }),
    }
    setBusy('answer')
    setError(null)
    void answerQuestion(wait, answer).catch((cause) => {
      setBusy(null)
      setError(cause instanceof Error ? cause.message : t('sideChat.interruptFailed'))
    })
  }

  const continueFlow = (): void => {
    if (!answered(draft)) {
      setError(t('sideChat.questionUnanswered'))
      return
    }
    if (index < questions.length - 1) {
      setIndex(current => current + 1)
      setError(null)
      return
    }
    submitDrafts(drafts)
  }

  const skipQuestion = (): void => {
    const nextDrafts = drafts.map((item, itemIndex) => itemIndex === index
      ? { selected: [], custom: '', skipped: true }
      : item)
    setDrafts(nextDrafts)
    setError(null)
    if (index < questions.length - 1) {
      setIndex(current => current + 1)
      return
    }
    submitDrafts(nextDrafts)
  }

  const onCustomKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    continueFlow()
  }

  return (
    <section
      className={minimized
        ? 'dsh-codex-sidechat-irq dsh-codex-sidechat-irq-min'
        : 'dsh-codex-sidechat-irq'}
      data-question-key={wait.key}
      aria-labelledby={`sidechat-q-${wait.key}-${String(index)}`}
    >
      <header className="dsh-codex-sidechat-irq-header">
        <div className="dsh-codex-sidechat-irq-heading">
          {question.header !== undefined && question.header.length > 0 && (
            <div className="dsh-codex-sidechat-irq-eyebrow">{question.header}</div>
          )}
          <h2 className="dsh-codex-sidechat-irq-title" id={`sidechat-q-${wait.key}-${String(index)}`}>
            {question.question}
          </h2>
        </div>
        <div className="dsh-codex-sidechat-irq-header-actions">
          <button
            type="button"
            className="dsh-codex-sidechat-irq-icon"
            aria-label={t(minimized ? 'sideChat.questionMaximize' : 'sideChat.questionMinimize')}
            disabled={busy !== null}
            onClick={() => { setMinimized(current => !current) }}
          >
            {minimized ? <IconChevronUpOutline14 size={14} /> : <IconChevronDownOutline14 size={14} />}
          </button>
          <button
            type="button"
            className="dsh-codex-sidechat-irq-icon"
            aria-label={t('sideChat.questionCancel')}
            disabled={busy !== null}
            onClick={() => {
              setBusy('cancel')
              setError(null)
              void cancelQuestion(wait).catch((cause) => {
                setBusy(null)
                setError(cause instanceof Error ? cause.message : t('sideChat.interruptFailed'))
              })
            }}
          >
            <IconCloseOutline16 size={16} />
          </button>
        </div>
      </header>

      {!minimized && (
        <>
          <div className="dsh-codex-sidechat-irq-body dsh-codex-sidechat-irq-scroll">
            {question.detail !== undefined && question.detail.length > 0 && (
              <div className="dsh-codex-sidechat-irq-detail">
                <MarkdownText text={question.detail} />
              </div>
            )}
            <div
              className="dsh-codex-sidechat-irq-options"
              role={question.multiSelect === true ? 'group' : 'radiogroup'}
            >
              {(question.options ?? []).map((option, optionIndex) => {
                const selected = draft.selected.includes(option.label)
                const display = parseRecommendedLabel(option.label)
                return (
                  <button
                    key={`${option.label}-${String(optionIndex)}`}
                    type="button"
                    className={selected && question.multiSelect !== true
                      ? 'dsh-codex-sidechat-irq-option is-selected'
                      : 'dsh-codex-sidechat-irq-option'}
                    role={question.multiSelect === true ? 'checkbox' : 'radio'}
                    aria-checked={selected}
                    disabled={busy !== null}
                    onClick={() => { choose(option.label) }}
                  >
                    {question.multiSelect === true ? (
                      <span className={selected
                        ? 'dsh-codex-sidechat-irq-check is-on'
                        : 'dsh-codex-sidechat-irq-check'}
                      >
                        {selected && <IconCheckOutline14 size={12} />}
                      </span>
                    ) : (
                      <span className="dsh-codex-sidechat-irq-num">{optionIndex + 1}</span>
                    )}
                    <span className="dsh-codex-sidechat-irq-option-copy">
                      <span className="dsh-codex-sidechat-irq-option-line">
                        <span className="dsh-codex-sidechat-irq-option-label">{display.label}</span>
                        {display.recommended && (
                          <span className="dsh-codex-sidechat-irq-badge">{t('sideChat.questionRecommended')}</span>
                        )}
                        {option.description !== undefined && option.description.length > 0 && (
                          <span className="dsh-codex-sidechat-irq-option-desc">{option.description}</span>
                        )}
                      </span>
                    </span>
                  </button>
                )
              })}
              {hasOptions ? (
                <div className={draft.custom !== ''
                  ? 'dsh-codex-sidechat-irq-custom is-active'
                  : 'dsh-codex-sidechat-irq-custom'}
                >
                  {question.multiSelect === true ? (
                    <span className={draft.custom !== ''
                      ? 'dsh-codex-sidechat-irq-check is-on'
                      : 'dsh-codex-sidechat-irq-check'}
                    >
                      {draft.custom !== '' && <IconCheckOutline14 size={12} />}
                    </span>
                  ) : (
                    <span className="dsh-codex-sidechat-irq-num">
                      <IconEditOutline16 size={12} />
                    </span>
                  )}
                  <textarea
                    className="dsh-codex-sidechat-irq-field"
                    rows={2}
                    value={draft.custom}
                    disabled={busy !== null}
                    placeholder={t('sideChat.questionPlaceholder')}
                    onChange={event => updateDraft(current => ({
                      ...current,
                      selected: question.multiSelect === true ? current.selected : [],
                      custom: event.target.value,
                      skipped: false,
                    }))}
                    onKeyDown={onCustomKeyDown}
                  />
                </div>
              ) : (
                <textarea
                  className="dsh-codex-sidechat-irq-field is-block"
                  rows={3}
                  value={draft.custom}
                  disabled={busy !== null}
                  placeholder={t('sideChat.questionPlaceholder')}
                  onChange={event => updateDraft(current => ({
                    ...current,
                    selected: [],
                    custom: event.target.value,
                    skipped: false,
                  }))}
                  onKeyDown={onCustomKeyDown}
                />
              )}
            </div>
          </div>
          <footer className="dsh-codex-sidechat-irq-footer">
            <div className="dsh-codex-sidechat-irq-pager">
              <button
                type="button"
                className="dsh-codex-sidechat-irq-icon"
                aria-label={t('sideChat.questionPrev')}
                disabled={index === 0 || busy !== null}
                onClick={() => { setIndex(index - 1); setError(null) }}
              >
                <IconChevronLeftOutline14 size={14} />
              </button>
              <span className="dsh-codex-sidechat-irq-progress">{index + 1} / {questions.length}</span>
              <button
                type="button"
                className="dsh-codex-sidechat-irq-icon"
                aria-label={t('sideChat.questionNext')}
                disabled={index === questions.length - 1 || busy !== null}
                onClick={() => { setIndex(index + 1); setError(null) }}
              >
                <IconChevronRightOutline14 size={14} />
              </button>
            </div>
            <div className="dsh-codex-sidechat-irq-error" role="status">{error ?? ''}</div>
            <div className="dsh-codex-sidechat-irq-footer-actions">
              <Button variant="outline" size="sm" disabled={busy !== null} onClick={skipQuestion}>
                {t('sideChat.questionSkip')}
              </Button>
              <Button variant="primary" size="sm" disabled={busy !== null || !answered(draft)} onClick={continueFlow}>
                {busy === 'answer'
                  ? t('sideChat.questionSubmitting')
                  : index === questions.length - 1
                    ? t('sideChat.questionSubmit')
                    : t('sideChat.questionNextAction')}
              </Button>
            </div>
          </footer>
        </>
      )}
    </section>
  )
}

async function answerQuestion(
  wait: PendingWait<'question'>,
  answer: { answers: readonly { id: string; selected: readonly string[]; custom?: string }[] },
): Promise<void> {
  const receipt = await wait.respond({
    ok: true,
    value: { sessionId: wait.sessionId, answer },
  })
  if (!receipt.accepted) throw new Error(receipt.reason ?? 'question response rejected')
}

async function cancelQuestion(wait: PendingWait<'question'>): Promise<void> {
  const receipt = await wait.respond({
    ok: false,
    error: {
      code: 'cancelled',
      message: 'the user closed this question request',
      details: {},
    },
  })
  if (!receipt.accepted) throw new Error(receipt.reason ?? 'question cancellation rejected')
}

function commandOf(
  runningCalls: readonly RunningToolCall[] | undefined,
  callId: string | undefined,
): string | undefined {
  if (callId === undefined || runningCalls === undefined) return undefined
  const call = findCall(runningCalls, callId)
  if (call === undefined) return undefined
  try {
    const args = JSON.parse(call.argsRaw) as { command?: unknown }
    return typeof args.command === 'string' ? args.command : undefined
  } catch {
    return undefined
  }
}

function findCall(blocks: readonly unknown[], callId: string): { argsRaw: string } | undefined {
  for (const block of blocks) {
    if (typeof block !== 'object' || block === null) continue
    const rec = block as { callId?: unknown; argsRaw?: unknown; subCalls?: unknown }
    if (rec.callId === callId && typeof rec.argsRaw === 'string') return { argsRaw: rec.argsRaw }
    if (Array.isArray(rec.subCalls)) {
      const found = findCall(rec.subCalls, callId)
      if (found !== undefined) return found
    }
  }
  return undefined
}

function planReviewOf(questions: readonly QuestionItem[]): PlanReview | undefined {
  if (questions.length !== 1) return undefined
  const question = questions[0]
  if (question === undefined) return undefined
  const intent = question.intent
  if (intent?.kind !== 'plan-review' || question.detail === undefined) return undefined
  if (question.multiSelect === true) return undefined
  const options = question.options ?? []
  if (options.length > 2) return undefined
  const approve = options.find(option => option.label === intent.approve)
  if (approve === undefined) return undefined
  const decline = options.find(option => option.label !== intent.approve)
  return {
    id: question.id,
    question: question.question,
    plan: question.detail,
    approve,
    ...(decline === undefined ? {} : { decline }),
  }
}

function parseRecommendedLabel(label: string): { label: string; recommended: boolean } {
  const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/iu
  return suffix.test(label)
    ? { label: label.replace(suffix, ''), recommended: true }
    : { label, recommended: false }
}
