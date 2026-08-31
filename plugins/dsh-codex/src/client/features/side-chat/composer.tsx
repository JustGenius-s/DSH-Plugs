/**
 * Side-chat composer: mirrors the DSH main composer's essentials.
 *
 * - textarea + send / stop (same `prompt` verb the main composer uses)
 * - image/file attachment through the conversation service's draft-image path
 * - model select through the session's model directory (`api.sessions.models`
 *   + `selectModel`), including the model's reasoning effort
 * - permission chip through the `/permission` slash command
 * - approval / ask_user_question takeover while `snapshot.pending` is waiting
 *
 * It is intentionally narrower than the full InputBar (no slash menu) — side
 * chats are for quick Q&A — but the transports are the same native verbs, so
 * attachments, model switching, sandbox permissions and host interrupts
 * behave like the main conversation.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconPlusOutline16,
  IconSendOutline16,
  IconStopFill16,
  Tooltip,
} from '@just-genius/dsh-plugin-ui'
import type {
  PendingInteraction,
  RunningToolCall,
} from '@just-genius/dsh-plugin-runtime/client'
import type { IApiClient } from '@just-genius/dsh-plugin-runtime/client'
import type { ModelCatalogModel, ModelReasoning, ModelSelection, SessionModels } from './types'
import {
  SideChatPermissionSelect,
  type PermissionProjectionFace,
} from './permission-select'
import { pickSideChatWait, SideChatInterrupt } from './interrupts'

/** The composer's session verbs (structural subset of SessionFace). */
export interface SideChatComposerSession {
  /** Raw session id (avoid the duplicated SessionId brand across dsh-session copies). */
  sessionId: string
  prompt(content: readonly unknown[], mode: 'queue' | 'steer'): Promise<unknown>
  cancel(): Promise<unknown>
  command?(line: string): Promise<unknown>
  /** Live sandbox-permission projection (`permissions` key). */
  projections?: PermissionProjectionFace
}

/** The attachment service face (subset of ctx.conversation). */
export interface SideChatConversationFace {
  createDraftImages(files: readonly File[]): readonly unknown[]
  draftImages(ids: readonly unknown[]): readonly unknown[]
  releaseDraftImage(id: unknown): void
}

export interface SideChatComposerProps {
  session: SideChatComposerSession
  running: boolean
  /** Host-owned approval / question waits that take over this composer. */
  pending?: readonly PendingInteraction[] | undefined
  /** Running tool calls used to pair an approval with its bash command. */
  runningCalls?: readonly RunningToolCall[] | undefined
  /** The `IApiClient` face for model directory / selection. */
  api?: IApiClient | undefined
  /** The `ctx.conversation` face for draft-image attachment handling. */
  conversation?: SideChatConversationFace | undefined
  onError: (message: string) => void
  t: (key: string) => string
}

/** Structured model directory snapshot kept in component state. */
interface ModelState {
  status: 'loading' | 'ready' | 'error'
  value?: SessionModels
  error?: string
}

/**
 * Render the composer.
 * @param props - the side session (methods invoked on it so `this` stays
 *   bound), the running flag, the model/attachment faces, and an error
 *   reporter.
 */
export function SideChatComposer({
  session,
  running,
  pending,
  runningCalls,
  api,
  conversation,
  onError,
  t,
}: SideChatComposerProps) {
  const wait = pickSideChatWait(pending)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [models, setModels] = useState<ModelState>({ status: 'loading' })
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [modelPane, setModelPane] = useState<'root' | 'model' | 'effort'>('root')
  // Draft image attachment ids (opaque tokens into the conversation service).
  const [draftIds, setDraftIds] = useState<readonly unknown[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)

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

  // Load the model directory once when the api face is available.
  useEffect(() => {
    if (api === undefined) return
    let alive = true
    void (async () => {
      setModels({ status: 'loading' })
      try {
        const result = await api.sessions.models({ sessionId: session.sessionId as never })
        if (!alive) return
        if (result.result.ok) {
          setModels({ status: 'ready', value: result.result.value })
        } else {
          setModels({ status: 'error', error: String(result.result.error?.message ?? 'model lookup failed') })
        }
      } catch (cause) {
        if (alive) {
          setModels({
            status: 'error',
            error: cause instanceof Error ? cause.message : 'model lookup failed',
          })
        }
      }
    })()
    return () => { alive = false }
  }, [api, session.sessionId])

  const submit = async (): Promise<void> => {
    const text = draft.trim()
    if ((text.length === 0 && draftIds.length === 0) || sending) return
    setDraft('')
    setSending(true)
    try {
      const content: unknown[] = []
      if (text.length > 0) content.push({ type: 'text', text })
      // Resolve draft images to browser-owned descriptors, then to wire parts.
      if (conversation !== undefined && draftIds.length > 0) {
        const images = conversation.draftImages(draftIds)
        for (const image of images as { file?: File; previewUrl?: string; id?: unknown }[]) {
          const file = image.file
          if (file !== undefined) {
            content.push({
              type: 'image',
              mediaType: file.type || 'image/png',
              data: await fileToDataUrl(file),
            })
          }
        }
      }
      const result = await session.prompt(content, 'queue')
      if (result != null && typeof result === 'object' && 'ok' in result
        && (result as { ok?: boolean }).ok === false) {
        const err = (result as { error?: { message?: string } }).error
        onError(err?.message ?? '消息发送失败')
      }
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : '消息发送失败')
    } finally {
      setSending(false)
      // Release consumed draft images.
      if (conversation !== undefined && draftIds.length > 0) {
        for (const id of draftIds) conversation.releaseDraftImage(id)
        setDraftIds([])
      }
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
    const created = conversation.createDraftImages(Array.from(files))
    if (created.length > 0) {
      setDraftIds(current => [...current, ...created.map((c) => (c as { id?: unknown }).id).filter((id): id is string => typeof id === 'string')])
    }
    event.target.value = ''
  }

  const removeDraft = (id: unknown): void => {
    conversation?.releaseDraftImage(id)
    setDraftIds(current => current.filter(item => item !== id))
  }

  // ── model select ────────────────────────────────────────────────────────
  const currentSelection = models.value?.current
  const currentCatalog = currentSelection === undefined
    ? undefined
    : catalogModel(models.value, currentSelection.provider, currentSelection.model)
  const selectedModelLabel = currentSelection === undefined
    ? undefined
    : (currentCatalog === undefined
      ? currentSelection.model
      : modelDisplayName(currentCatalog))
  const reasoning = currentCatalog?.reasoning
  const selectedEffortLabel = effortCaption(reasoning, currentSelection?.reasoningEffort)

  const applySelection = (selected: ModelSelection): void => {
    setModels(current => current.value === undefined
      ? current
      : { status: 'ready', value: { ...current.value, current: selected } })
  }

  const selectRoute = (provider: string, model: string, reasoningEffort?: string): void => {
    if (api === undefined) return
    const payload: {
      sessionId: never
      provider: string
      model: string
      reasoningEffort?: string
    } = {
      sessionId: session.sessionId as never,
      provider,
      model,
    }
    if (reasoningEffort !== undefined) payload.reasoningEffort = reasoningEffort
    void api.sessions.selectModel(payload).then((result) => {
      const res = result.result
      if (res.ok) applySelection(res.value.selected)
      else onError(String(res.error?.message ?? '模型切换失败'))
    }).catch((cause) => {
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
        <SideChatInterrupt wait={wait} runningCalls={runningCalls} t={t} />
      </div>
    )
  }

  return (
    <form className="dsh-codex-sidechat-composer" onSubmit={onSubmit}>
      {draftIds.length > 0 && (
        <div className="dsh-codex-sidechat-attachments">
          {draftIds.map((id) => (
            <span key={String(id)} className="dsh-codex-sidechat-attachment-chip">
              🖼 图片
              <button
                type="button"
                className="dsh-codex-sidechat-attachment-remove"
                onClick={() => removeDraft(id)}
                aria-label="移除附件"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="dsh-codex-sidechat-card">
        <textarea
          className="dsh-codex-sidechat-composer-input"
          rows={3}
          value={draft}
          placeholder="给智能体发消息"
          onChange={event => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void submit()
            }
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
                disabled={models.status !== 'ready' || (models.value?.groups.length ?? 0) === 0}
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
                  {models.status === 'error' && (
                    <div className="dsh-codex-sidechat-model-error">
                      {models.error ?? '模型目录加载失败'}
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
                      {(models.value?.groups ?? []).map(group => (
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

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('read file failed'))
    reader.readAsDataURL(file)
  })
}
