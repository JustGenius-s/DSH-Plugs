/**
 * Side-chat composer: mirrors the DSH main composer's essentials.
 *
 * - textarea + send / stop (same `prompt` verb the main composer uses)
 * - image/file attachment through the conversation service's draft API
 * - model select through `ctx.modelDirectories` (DSH 0.1.2's per-session
 *   directory; the old `connection.api.sessions.models` RPC was REMOVED in
 *   0.1.2 — see ./model-directory), including the model's reasoning effort
 * - permission chip through the `/permission` slash command
 * - approval / ask_user_question takeover while the host is waiting
 *
 * It is intentionally narrower than the full InputBar (no slash menu) — side
 * chats are for quick Q&A — but the transports are the same native verbs, so
 * attachments, model switching, sandbox permissions and host interrupts
 * behave like the main conversation.
 */

import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react'
import {
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconPlusOutline16,
  IconSendOutline16,
  IconStopFill16,
  Tooltip,
} from '@just-genius/dsh-plugin-ui'
import {
  draftPreviewsOf,
  imageFilesOf,
  type SideChatConversationFace,
} from './connection'
import { sideChatApi } from './api'
import { filterReferenceCandidates, insertSessionMention, mentionKeyAction, mentionQuery, moveMentionSelection } from './mentions'
import type { SideChatReferenceCandidate } from '../../../shared/side-chat'
import type { ModelCatalogModel, ModelReasoning, ModelSelection, SessionModels } from './types'
import { modelLookupErrorMessage, modelMenuNotice } from './model-picker'
import {
  loadModelDirectory,
  MODEL_DIRECTORY_MISSING_MESSAGE,
  selectModel,
  type ModelDirectoryResolverFace,
} from './model-directory'
import {
  SideChatPermissionSelect,
  type PermissionProjectionFace,
} from './permission-select'
import { SideChatInterrupt, type ChatLike } from './interrupts'
import {
  rawPendingOf,
  recognizeWait,
  type PendingInteractionsFace,
} from './pending'

/** The composer's session verbs (structural subset of SessionFace). */
export interface SideChatComposerSession {
  /** Raw session id (avoid the duplicated SessionId brand across dsh-session copies). */
  sessionId: string
  getSnapshot(): unknown
  beginSubmission(input: unknown): unknown
  prompt(content: readonly unknown[], mode: 'queue' | 'steer', signal?: AbortSignal, requestId?: unknown): Promise<unknown>
  cancel(): Promise<unknown>
  command?(line: string): Promise<unknown>
  /** Live sandbox-permission projection (`permissions` key). */
  projections?: PermissionProjectionFace
}

export interface SideChatComposerProps {
  session: SideChatComposerSession
  running: boolean
  /**
   * The host's session-status observable, carrying pending interactions.
   */
  pendingInteractions?: PendingInteractionsFace | undefined
  /** Chat content rows, used to pair an approval with the command it asks about. */
  chat?: ChatLike | undefined
  /**
   * The `ctx.modelDirectories` resolver for the model directory / selection.
   * DSH 0.1.2 route; see ./model-directory for why the old api face is gone.
   */
  modelDirectories?: ModelDirectoryResolverFace | undefined
  /** The validated `ctx.conversation` face for draft attachment handling. */
  conversation?: SideChatConversationFace | undefined
  onError: (message: string) => void
  t: (key: string) => string
}

/** Structured model directory snapshot kept in component state. */
type ModelState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; value: SessionModels }

/**
 * Render the composer.
 * @param props - the side session (methods invoked on it so `this` stays
 *   bound), the running flag, the model/attachment faces, and an error
 *   reporter.
 */
export function SideChatComposer({
  session,
  running,
  pendingInteractions,
  chat,
  modelDirectories,
  conversation,
  onError,
  t,
}: SideChatComposerProps) {
  // The status store is an observable indexed by session: subscribe so a wait
  // that arrives while this panel is mounted takes over the composer.
  // The snapshot reads the RAW carrier — the store's own object identity — so
  // it stays referentially stable between updates; recognition runs in a memo
  // below, because building a view object inside getSnapshot would make uSES
  // re-render forever.
  const carrier = useSyncExternalStore(
    (fn) => (pendingInteractions === undefined ? () => {} : pendingInteractions.subscribe(fn)),
    () => rawPendingOf(pendingInteractions, session.sessionId),
  )
  const wait = useMemo(() => recognizeWait(carrier), [carrier])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [models, setModels] = useState<ModelState>({ status: 'loading' })
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [modelPane, setModelPane] = useState<'root' | 'model' | 'effort'>('root')
  // Draft image attachment ids (opaque tokens into the conversation service).
  const [draftIds, setDraftIds] = useState<readonly unknown[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const mentionMenuRef = useRef<HTMLDivElement>(null)
  const mentionListId = useId()
  const [caret, setCaret] = useState({ start: 0, end: 0 })
  const [mentionDismissed, setMentionDismissed] = useState(false)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [referenceState, setReferenceState] = useState<{
    sessionId: string
    rows: SideChatReferenceCandidate[]
    loading: boolean
    error?: string
  }>({ sessionId: '', rows: [], loading: true })
  const range = mentionDismissed ? undefined : mentionQuery(draft, caret.start, caret.end)
  const mentionOpen = range !== undefined
  const referenceLoading = referenceState.loading || referenceState.sessionId !== session.sessionId
  const referenceRows = useMemo(() => filterReferenceCandidates(
    referenceLoading ? [] : referenceState.rows, range?.query ?? '',
  ), [referenceLoading, referenceState.rows, range?.query])
  const activeMentionIndex = Math.min(mentionIndex, Math.max(0, referenceRows.length - 1))

  useEffect(() => {
    if (!mentionOpen) return
    const controller = new AbortController()
    setReferenceState({ sessionId: session.sessionId, rows: [], loading: true })
    void sideChatApi.references(session.sessionId, controller.signal).then(rows => {
      if (!controller.signal.aborted) setReferenceState({ sessionId: session.sessionId, rows, loading: false })
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setReferenceState({
        sessionId: session.sessionId, rows: [], loading: false,
        error: cause instanceof Error ? cause.message : '会话列表加载失败',
      })
    })
    return () => controller.abort()
  }, [mentionOpen, session.sessionId])

  useEffect(() => { setMentionIndex(0) }, [range?.query, range?.start])
  useEffect(() => {
    mentionMenuRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeMentionIndex])

  const pickReference = (row: SideChatReferenceCandidate): void => {
    if (range === undefined) return
    const next = insertSessionMention(draft, range, row.mention)
    setDraft(next.text)
    setCaret({ start: next.caret, end: next.caret })
    setMentionDismissed(true)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(next.caret, next.caret)
    })
  }

  // Close the model menu on outside click / Escape.
  useEffect(() => {
    if (!modelMenuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      const el = modelMenuRef.current
      if (el !== null && event.target instanceof Node && !el.contains(event.target)) {
        setModelMenuOpen(false)
        setModelPane('root')
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (modelPane !== 'root') {
        setModelPane('root')
        return
      }
      setModelMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [modelMenuOpen, modelPane])

  // Load the model directory once the directory service is available.
  useEffect(() => {
    // Say so instead of parking on "模型…" forever: a missing service used to
    // be indistinguishable from a slow lookup, and the picker looked broken.
    // The message names the service to inject, because the old text blamed a
    // `connection.api` that DSH 0.1.2 removed — sending the reader after an
    // inject entry that was already present.
    if (modelDirectories === undefined) {
      setModels({ status: 'error', message: MODEL_DIRECTORY_MISSING_MESSAGE })
      return
    }
    let alive = true
    void (async () => {
      setModels({ status: 'loading' })
      try {
        const value = await loadModelDirectory(modelDirectories, session.sessionId)
        if (alive) setModels({ status: 'ready', value })
      } catch (cause) {
        if (alive) setModels({ status: 'error', message: modelLookupErrorMessage(cause) })
      }
    })()
    return () => { alive = false }
  }, [modelDirectories, session.sessionId])

  const submit = async (): Promise<void> => {
    const text = draft.trim()
    if ((text.length === 0 && draftIds.length === 0) || sending) return
    const submittedDraft = draft
    const submittedIds = draftIds
    setDraft('')
    setSending(true)
    try {
      if (conversation === undefined) throw new Error('会话发送服务不可用')
      // The 0.1.7 send path owns the local echo and draft attachment lifecycle.
      // Calling session.prompt directly bypasses both, leaving queued sends
      // invisible until Host admission and leaking browser draft attachments.
      const result = await conversation.sendSession(session, text, submittedIds, 'queue')
      if (result.kind !== 'success') throw new Error(result.text ?? '消息发送失败')
      if (submittedIds.length > 0) {
        const consumed = new Set(submittedIds)
        setDraftIds(current => current.filter(id => !consumed.has(id)))
      }
    } catch (cause) {
      // Match the native composer's failure contract: keep attachments and
      // restore the submitted text when the user has not started a new draft.
      setDraft(current => current.length === 0 ? submittedDraft : current)
      onError(cause instanceof Error ? cause.message : '消息发送失败')
    } finally {
      setSending(false)
    }
  }

  const stop = (): void => {
    void session.cancel()
  }

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault()
    void submit()
  }

  const onPickFiles = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const files = event.target.files
    if (files === null || files.length === 0 || conversation === undefined) return
    addFiles(Array.from(files))
    event.target.value = ''
  }

  /**
   * Paste: an image on the clipboard becomes an attachment.
 *
   * Copying an image and pasting it into the composer is the natural gesture,
   * and without this handler it did nothing at all — the only way to attach
   * was the file picker. Text pastes fall through to the textarea's own
   * behaviour so a pasted snippet still lands in the draft.
   */
  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    if (conversation === undefined) return
    const files = imageFilesOf(event.clipboardData)
    if (files.length === 0) return
    event.preventDefault()
    addFiles(files)
  }

  const addFiles = (files: readonly File[]): void => {
    if (conversation === undefined) return
    try {
      const created = conversation.createDrafts(session.sessionId, files)
      if (created.length === 0) return
      setDraftIds(current => [
        ...current,
        ...created.map(item => item.id).filter((id): id is string => typeof id === 'string'),
      ])
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : '附件添加失败')
    }
  }

  const removeDraft = (id: unknown): void => {
    conversation?.releaseDraftAttachment(id)
    setDraftIds(current => current.filter(item => item !== id))
  }

  const draftPreviews = useMemo(
    () => draftPreviewsOf(conversation, draftIds),
    [conversation, draftIds],
  )

  // ── model select ────────────────────────────────────────────────────────
  const directory = models.status === 'ready' ? models.value : undefined
  const notice = modelMenuNotice(models)
  const currentSelection = directory?.current
  const currentCatalog = currentSelection === undefined
    ? undefined
    : catalogModel(directory, currentSelection.provider, currentSelection.model)
  const selectedModelLabel = currentSelection === undefined
    ? undefined
    : (currentCatalog === undefined
      ? currentSelection.model
      : modelDisplayName(currentCatalog))
  const reasoning = currentCatalog?.reasoning
  const selectedEffortLabel = effortCaption(reasoning, currentSelection?.reasoningEffort)

  const applySelection = (selected: ModelSelection): void => {
    setModels(current => current.status !== 'ready'
      ? current
      : { status: 'ready', value: { ...current.value, current: selected } })
  }

  const selectRoute = (provider: string, model: string, reasoningEffort?: string): void => {
    if (modelDirectories === undefined) return
    const selection: ModelSelection = { provider, model }
    if (reasoningEffort !== undefined) selection.reasoningEffort = reasoningEffort
    // The directory applies the durable projection itself, so the shared
    // snapshot is the source of truth afterwards — the old route read the
    // selection back out of an RPC result and could race a newer switch.
    void selectModel(modelDirectories, session.sessionId, selection)
      .then(() => applySelection(selection))
      .catch((cause) => {
        onError(cause instanceof Error ? cause.message : '模型切换失败')
      })
  }

  const onSelectModel = (provider: string, model: string): void => {
    setModelMenuOpen(false)
    setModelPane('root')
    if (currentSelection?.provider === provider && currentSelection.model === model) return
    selectRoute(provider, model)
  }

  const onSelectEffort = (effort: string | undefined): void => {
    setModelMenuOpen(false)
    setModelPane('root')
    if (currentSelection === undefined) return
    if (currentSelection.reasoningEffort === effort) return
    selectRoute(currentSelection.provider, currentSelection.model, effort)
  }

  const efforts = effortChoices(reasoning)

  const openModelMenu = (): void => {
    setModelPane('root')
    setModelMenuOpen(current => !current)
  }

  if (wait !== undefined) {
    return (
      <div className="dsh-codex-sidechat-composer">
        <SideChatInterrupt wait={wait} chat={chat} t={t} />
      </div>
    )
  }

  return (
    <form className="dsh-codex-sidechat-composer" onSubmit={onSubmit}>
      {draftIds.length > 0 && (
        <div className="dsh-codex-sidechat-attachments">
          {draftPreviews.map((preview) => (
            <span key={preview.key} className="dsh-codex-sidechat-attachment-chip">
              {/* The draft's own object URL, exactly as the main composer shows
                  it: a real thumbnail, not a placeholder glyph. */}
              {preview.url === undefined
                ? <span className="dsh-codex-sidechat-attachment-fallback" aria-hidden="true">🖼</span>
                : <img
                    className="dsh-codex-sidechat-attachment-thumb"
                    src={preview.url}
                    alt={preview.name}
                  />}
              <span className="dsh-codex-sidechat-attachment-name">{preview.name}</span>
              <button
                type="button"
                className="dsh-codex-sidechat-attachment-remove"
                onClick={() => removeDraft(preview.id)}
                aria-label={`移除 ${preview.name}`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="dsh-codex-sidechat-card">
        {mentionOpen && (
          <div className="dsh-codex-sidechat-mentions" ref={mentionMenuRef}>
            <div className="dsh-codex-sidechat-mentions-heading">近七天活跃会话</div>
            {referenceLoading ? <div className="dsh-codex-sidechat-mentions-status" role="status">正在加载会话…</div>
              : referenceState.error ? <div className="dsh-codex-sidechat-mentions-status" role="alert">{referenceState.error}</div>
                : referenceRows.length === 0 ? <div className="dsh-codex-sidechat-mentions-status" role="status">没有匹配的会话</div> : null}
            <div id={mentionListId} role="listbox" aria-label="近七天活跃会话" className="dsh-codex-sidechat-mentions-list">
              {referenceRows.map((row, index) => (
                <Fragment key={row.sessionId}>
                  {(index === 0 || row.sameWorkspace !== referenceRows[index - 1]?.sameWorkspace) && (
                    <div className="dsh-codex-sidechat-mentions-heading" role="presentation">
                      {row.sameWorkspace ? '当前工作区' : '其他工作区'}
                    </div>
                  )}
                  <button
                    type="button"
                    role="option"
                    id={`${mentionListId}-${index}`}
                    aria-selected={index === activeMentionIndex}
                    tabIndex={-1}
                    className="dsh-codex-sidechat-mention-option"
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => pickReference(row)}
                    title={`${row.displayTitle ?? row.label}\n${row.cwd ?? ''}\n${row.sessionId}`}
                  >
                    <span className="dsh-codex-sidechat-mention-title">{row.displayTitle ?? row.label}</span>
                    <span className="dsh-codex-sidechat-mention-id">{row.cwd ? `${row.cwd} · ` : ''}{row.sessionId}</span>
                  </button>
                </Fragment>
              ))}
            </div>
          </div>
        )}
        <textarea
          ref={inputRef}
          className="dsh-codex-sidechat-composer-input"
          rows={3}
          value={draft}
          placeholder="给智能体发消息"
          aria-label="侧聊消息"
          aria-autocomplete="list"
          aria-controls={mentionOpen ? mentionListId : undefined}
          aria-activedescendant={mentionOpen && referenceRows.length > 0 ? `${mentionListId}-${activeMentionIndex}` : undefined}
          onChange={event => {
            setDraft(event.target.value)
            setCaret({ start: event.target.selectionStart, end: event.target.selectionEnd })
            setMentionDismissed(false)
          }}
          onSelect={event => {
            setCaret({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })
          }}
          onBlur={event => {
            if (!mentionMenuRef.current?.contains(event.relatedTarget)) setMentionDismissed(true)
          }}
          onPaste={onPaste}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return
            if (mentionOpen) {
              const action = mentionKeyAction(event.key, event.shiftKey, false)
              if (action === 'dismiss') {
                event.preventDefault()
                event.stopPropagation()
                setMentionDismissed(true)
                return
              }
              if (action === 'next' || action === 'previous') {
                event.preventDefault()
                setMentionIndex(moveMentionSelection(activeMentionIndex, action === 'next' ? 1 : -1, referenceRows.length))
                return
              }
              if (action === 'pick') {
                event.preventDefault()
                const row = referenceRows[activeMentionIndex]
                if (row !== undefined) pickReference(row)
                return
              }
            }
            if (event.key !== 'Enter' || event.shiftKey) return
            // Enter must not send while an IME candidate window is open: the
            // keypress belongs to the composition (confirming 中文/日本語
            // candidates), and firing here both submitted a half-finished
            // sentence and swallowed the confirmation. `isComposing` is the
            // standard signal; `keyCode === 229` covers the browsers that do
            // not set it.
            if (event.nativeEvent.isComposing || event.keyCode === 229) return
            event.preventDefault()
            void submit()
          }}
        />
        <div className="dsh-codex-sidechat-composer-tools">
          {/* Left cluster: attach + sandbox permission. */}
          <div className="dsh-codex-sidechat-tools-left">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={onPickFiles}
            />
            <Tooltip label="添加图片" delayMs={500} side="top">
              <button
                type="button"
                className="dsh-codex-sidechat-add"
                onClick={() => fileInputRef.current?.click()}
                disabled={conversation === undefined}
                aria-label="添加图片"
              >
                <IconPlusOutline16 size={16} />
              </button>
            </Tooltip>

            <SideChatPermissionSelect
              projections={session.projections}
              command={session.command}
              t={t}
              onError={onError}
            />
          </div>

          {/* Right cluster: model select + round send button. */}
          <div className="dsh-codex-sidechat-tools-right">
            <div className="dsh-codex-sidechat-model-root" ref={modelMenuRef}>
              <button
                type="button"
                className="dsh-codex-sidechat-select"
                onClick={openModelMenu}
                title={selectedEffortLabel === undefined
                  ? selectedModelLabel
                  : `${selectedModelLabel} · ${selectedEffortLabel}`}
              >
                <span className="dsh-codex-sidechat-select-label">
                  {models.status === 'loading' ? '模型…' : (selectedModelLabel ?? '选择模型')}
                </span>
                {selectedEffortLabel !== undefined && (
                  <span className="dsh-codex-sidechat-select-effort">{selectedEffortLabel}</span>
                )}
                <IconChevronDownOutline14
                  size={14}
                  className={modelMenuOpen
                    ? 'dsh-codex-sidechat-chevron dsh-codex-sidechat-chevron-open'
                    : 'dsh-codex-sidechat-chevron'}
                />
              </button>

              {modelMenuOpen && (
                <div className="dsh-codex-sidechat-model-menu" role="menu">
                  {notice.text !== undefined && (
                    <div className="dsh-codex-sidechat-model-error">
                      {notice.text}
                      {(notice.details?.length ?? 0) > 0 && (
                        <span className="dsh-codex-sidechat-model-error-detail">
                          {notice.details?.join('；')}
                        </span>
                      )}
                    </div>
                  )}
                  {modelPane === 'root' && (
                    <div className="dsh-codex-sidechat-model-root-pane">
                      <button
                        type="button"
                        className="dsh-codex-sidechat-model-cell"
                        onClick={() => setModelPane('model')}
                      >
                        <span className="dsh-codex-sidechat-model-cell-label">模型</span>
                        <span className="dsh-codex-sidechat-model-cell-value">{selectedModelLabel ?? '选择模型'}</span>
                        <IconChevronRightOutline14 size={14} className="dsh-codex-sidechat-model-cell-chevron" />
                      </button>
                      {reasoning !== undefined && (
                        <button
                          type="button"
                          className="dsh-codex-sidechat-model-cell"
                          onClick={() => setModelPane('effort')}
                        >
                          <span className="dsh-codex-sidechat-model-cell-label">推理等级</span>
                          <span className="dsh-codex-sidechat-model-cell-value">{selectedEffortLabel ?? 'Default'}</span>
                          <IconChevronRightOutline14 size={14} className="dsh-codex-sidechat-model-cell-chevron" />
                        </button>
                      )}
                    </div>
                  )}
                  {modelPane === 'model' && (
                    <div className="dsh-codex-sidechat-model-groups">
                      {(directory?.groups ?? []).map(group => (
                        <div key={group.id} className="dsh-codex-sidechat-model-group">
                          <div className="dsh-codex-sidechat-model-group-title">{group.name}</div>
                          {group.models.map(model => {
                            const selected = currentSelection !== undefined
                              && currentSelection.provider === group.id
                              && currentSelection.model === model.id
                            return (
                              <button
                                key={model.id}
                                type="button"
                                role="menuitemradio"
                                aria-checked={selected}
                                className={selected
                                  ? 'dsh-codex-sidechat-model-option dsh-codex-sidechat-model-option-selected'
                                  : 'dsh-codex-sidechat-model-option'}
                                onClick={() => onSelectModel(group.id, model.id)}
                              >
                                <span className="dsh-codex-sidechat-model-option-copy">
                                  <span className="dsh-codex-sidechat-model-name">{modelDisplayName(model)}</span>
                                </span>
                                {selected && (
                                  <span className="dsh-codex-sidechat-model-check">
                                    <IconCheckOutline16 size={16} />
                                  </span>
                                )}
                              </button>
                            )
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                  {modelPane === 'effort' && (
                    <div className="dsh-codex-sidechat-model-groups">
                      {efforts.length === 0 ? (
                        <div className="dsh-codex-sidechat-model-empty">当前模型未提供推理等级</div>
                      ) : efforts.map(choice => {
                        const selected = (currentSelection?.reasoningEffort ?? reasoning?.defaultEffort) === choice.effort
                        return (
                          <button
                            key={choice.key}
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            className={selected
                              ? 'dsh-codex-sidechat-model-option dsh-codex-sidechat-model-option-selected'
                              : 'dsh-codex-sidechat-model-option'}
                            onClick={() => onSelectEffort(choice.effort)}
                          >
                            <span className="dsh-codex-sidechat-model-option-copy">
                              <span className="dsh-codex-sidechat-model-name">{choice.label}</span>
                              {choice.description !== undefined && choice.description.length > 0 && (
                                <span className="dsh-codex-sidechat-model-desc">{choice.description}</span>
                              )}
                            </span>
                            {selected && (
                              <span className="dsh-codex-sidechat-model-check">
                                <IconCheckOutline16 size={16} />
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {running
              ? (
                <button
                  type="button"
                  className="dsh-codex-sidechat-primary"
                  onClick={stop}
                  aria-label="停止"
                >
                  <IconStopFill16 size={16} />
                </button>
              )
              : (
                <button
                  type="submit"
                  className="dsh-codex-sidechat-primary"
                  disabled={(draft.trim().length === 0 && draftIds.length === 0) || sending}
                  aria-label="发送"
                >
                  <IconSendOutline16 size={16} />
                </button>
              )}
          </div>
        </div>
      </div>
    </form>
  )
}

/** Catalog row plus an optional untyped `displayName` some adapters still send. */
type CatalogModelLabel = {
  id: string
  /** Optional on the official catalog entry; the label falls back to the id. */
  name?: string
  displayName?: string
}

/** Visible model label: displayName, then catalog name, never the route id. */
function modelDisplayName(model: CatalogModelLabel): string {
  const extra = model.displayName
  if (typeof extra === 'string' && extra.trim().length > 0) return extra.trim()
  if (typeof model.name === 'string' && model.name.trim().length > 0) return model.name
  return model.id
}

function catalogModel(
  directory: SessionModels | undefined,
  provider: string,
  modelId: string,
): ModelCatalogModel | undefined {
  for (const group of directory?.groups ?? []) {
    if (group.id !== provider) continue
    return group.models.find(model => model.id === modelId)
  }
  return undefined
}

function effortCaption(reasoning: ModelReasoning | undefined, currentEffort: string | undefined): string | undefined {
  if (reasoning === undefined) return undefined
  const effective = currentEffort ?? reasoning.defaultEffort
  if (effective === undefined) return 'Default'
  return reasoning.efforts?.find(effort => effort.id === effective)?.name ?? effective
}

interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
  description?: string
}

function effortChoices(reasoning: ModelReasoning | undefined): readonly EffortChoice[] {
  if (reasoning === undefined) return []
  const out: EffortChoice[] = []
  if (reasoning.defaultEffort === undefined) {
    out.push({ key: 'provider-default', effort: undefined, label: 'Default' })
  }
  for (const effort of reasoning.efforts ?? []) {
    out.push({
      key: effort.id,
      effort: effort.id,
      label: effort.name ?? effort.label ?? effort.id,
      ...(effort.description === undefined ? {} : { description: effort.description }),
    })
  }
  return out
}
