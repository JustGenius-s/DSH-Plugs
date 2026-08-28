import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FormEvent, KeyboardEvent, ReactNode } from 'react'
import type {
  SessionBinding,
  SessionId,
  SessionListState,
  WorkspaceId,
} from '@just-genius/dsh-plugin-runtime/client'
import type { SnapshotSelectorHook } from '@just-genius/dsh-plugin-runtime/client'
import { zh, type WeChatKey } from './locales.ts'
import { useBinding, useLiveSnapshot, useRecentSnapshots, useWeChatEnabled } from './hooks.ts'
import { MomentsFeed } from './Moments.tsx'
import { projectMoments } from './moments.ts'
import {
  formatClock,
  lastPreview,
  projectChat,
  runningToolHint,
  type WeChatItem,
} from './project.ts'
import type { ModelDirectoryFace, ModelPick } from './models.ts'
import styles from './WeChatApp.module.css'
import {
  Avatar,
  IconCameraMini,
  IconChat,
  IconDiscover,
  IconMe,
  IconPeople,
  IconPlus,
  IconScan,
  RailButton,
  WeChatMark,
} from './chrome.tsx'
import { MePanel } from './MePanel.tsx'

type Tab = 'chats' | 'contacts' | 'discover' | 'me'

export interface WeChatAppInjected {
  t: (key: WeChatKey) => string
  open: (id: SessionId) => void
  startSession: (workspaceId?: WorkspaceId) => void
  bindingOf: (id: string) => SessionBinding | undefined
  archiveSession: (id: SessionId) => Promise<void>
  pickDirectory: () => Promise<string | null>
  createWorkspace: (path: string) => Promise<{ workspaceId: WorkspaceId }>
  connectWorkspace: (id: WorkspaceId) => Promise<SessionId>
  directoryFor?: (id: string) => ModelDirectoryFace | undefined
  saveDefaultModel?: (pick: ModelPick) => Promise<void>
}

export interface WeChatAppProps {
  useSessions: SnapshotSelectorHook<SessionListState>
  useWorkspaces: SnapshotSelectorHook<{
    items: readonly { workspaceId: WorkspaceId; title?: string; path?: string }[]
    recentWorkspaceId?: WorkspaceId
  }>
  t: (key: WeChatKey) => string
  open: (id: SessionId) => void
  startSession: (workspaceId?: WorkspaceId) => void
  bindingOf: (id: string) => SessionBinding | undefined
  archiveSession: (id: SessionId) => Promise<void>
  pickDirectory: () => Promise<string | null>
  createWorkspace: (path: string) => Promise<{ workspaceId: WorkspaceId }>
  connectWorkspace: (id: WorkspaceId) => Promise<SessionId>
  directoryFor?: (id: string) => ModelDirectoryFace | undefined
  saveDefaultModel?: (pick: ModelPick) => Promise<void>
}

export function WeChatApp(props: WeChatAppProps) {
  const { useSessions, useWorkspaces } = props
  const t = props.t ?? ((key: WeChatKey) => zh[key])
  const [enabled, setEnabled] = useWeChatEnabled()
  const current = useSessions((s) => s.current)
  const ids = useSessions((s) => s.ids)
  const byId = useSessions((s) => s.byId)
  const workspaces = useWorkspaces((s) => s.items)
  const recentWorkspaceId = useWorkspaces((s) => s.recentWorkspaceId)
  const [tab, setTab] = useState<Tab>('chats')
  const [query, setQuery] = useState('')
  const [mobileChat, setMobileChat] = useState(false)

  const allChats = useMemo(
    () => ids.map((id) => byId[id]).filter((row) => row && !row.blank && row.origin !== 'subagent'),
    [ids, byId],
  )
  const chats = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return allChats
    return allChats.filter((row) => row.displayTitle.toLowerCase().includes(needle))
  }, [allChats, query])

  const binding = useBinding(current, props.bindingOf)
  const snapshot = useLiveSnapshot(binding?.session)
  const items = useMemo(() => projectChat(snapshot, t), [snapshot, t])
  const modelSessionId = current ?? ids.find((id) => byId[id] && byId[id].origin !== 'subagent')
  const recentIds = useMemo(
    () => allChats.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12).map((row) => row.id),
    [allChats],
  )
  const snapshots = useRecentSnapshots(recentIds, props.bindingOf)
  const moments = useMemo(
    () => projectMoments(allChats, { ...snapshots, ...current ? { [current]: snapshot } : {} }, t),
    [allChats, snapshots, current, snapshot, t],
  )

  const openChat = (id: SessionId) => {
    props.open(id)
    setTab('chats')
    setMobileChat(true)
  }

  useEffect(() => {
    if (current) setMobileChat(true)
  }, [current])

  if (!enabled) {
    return toBody(
      <button type="button" className={styles.fab} onClick={() => setEnabled(true)} title={t('fab')} aria-label={t('fab')}>
        <WeChatMark />
      </button>,
    )
  }

  const currentRow = current ? byId[current] : undefined
  const title = currentRow?.displayTitle ?? t('brand')
  const subtitle = snapshot?.running
    ? (runningToolHint(snapshot.runningCalls) ?? t('typing'))
    : undefined

  return toBody(
    <div className={styles.shell} data-wechat-root="1" data-mobile-chat={mobileChat && current ? 'true' : 'false'}>
      <nav className={styles.rail} aria-label={t('brand')}>
        <div className={styles.railAvatar}>DS</div>
        <RailButton active={tab === 'chats'} label={t('tab.chats')} onClick={() => { setTab('chats'); setMobileChat(false) }}>
          <IconChat />
        </RailButton>
        <RailButton active={tab === 'contacts'} label={t('tab.contacts')} onClick={() => setTab('contacts')}>
          <IconPeople />
        </RailButton>
        <RailButton active={tab === 'discover'} label={t('tab.discover')} onClick={() => setTab('discover')}>
          <IconDiscover />
        </RailButton>
        <div className={styles.railGrow} />
        <RailButton active={tab === 'me'} label={t('tab.me')} onClick={() => setTab('me')}>
          <IconMe />
        </RailButton>
      </nav>

      <aside className={styles.column}>
        {tab === 'chats' && (
          <>
            <div className={styles.listHead}>
              <div className={styles.listTitle}>{t('tab.chats')}</div>
              <button type="button" className={styles.iconBtn} title={t('newChat')} onClick={() => props.startSession(recentWorkspaceId)}>
                <IconPlus />
              </button>
            </div>
            <div className={styles.searchWrap}>
              <input className={styles.search} value={query} placeholder={t('search')} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className={styles.list}>
              {chats.length === 0 && (
                <div className={styles.paneEmpty}>
                  <div className={styles.emptyMark}><WeChatMark /></div>
                  <p>{t('emptyChats')}</p>
                </div>
              )}
              {chats.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={styles.row}
                  data-active={row.id === current}
                  data-live={row.running}
                  onClick={() => { props.open(row.id); setMobileChat(true) }}
                >
                  <Avatar id={row.id} title={row.displayTitle} />
                  <div className={styles.rowBody}>
                    <div className={styles.rowTop}>
                      <div className={styles.rowName}>{row.displayTitle}</div>
                      <div className={styles.rowTime}>{formatClock(row.updatedAt, t)}</div>
                    </div>
                    <div className={styles.rowPreview}>
                      {row.id === current ? lastPreview(items, row, t) : lastPreview([], row, t)}
                    </div>
                  </div>
                  {row.pendingInteraction && <span className={styles.badge} />}
                  {!row.pendingInteraction && row.completed && <span className={`${styles.badge} ${styles.badgeDone}`} />}
                </button>
              ))}
            </div>
          </>
        )}

        {tab === 'contacts' && (
          <>
            <div className={styles.listHead}>
              <div className={styles.listTitle}>{t('tab.contacts')}</div>
              <button type="button" className={styles.iconBtn} title={t('pickFolder')} onClick={() => void addWorkspace(props)}>
                <IconPlus />
              </button>
            </div>
            <div className={styles.emptyHint}>{t('contactsHint')}</div>
            <div className={styles.list}>
              {workspaces.length === 0 && <div className={styles.emptyHint}>{t('emptyContacts')}</div>}
              {workspaces.map((ws) => (
                <button
                  key={ws.workspaceId}
                  type="button"
                  className={styles.row}
                  onClick={() => void openWorkspace(props, ws.workspaceId)}
                >
                  <Avatar id={ws.workspaceId} title={ws.title || ws.path || ws.workspaceId} />
                  <div className={styles.rowBody}>
                    <div className={styles.rowName}>{ws.title || ws.path || ws.workspaceId}</div>
                    <div className={styles.rowPreview}>{ws.path ?? ''}</div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {tab === 'discover' && (
          <>
            <div className={styles.listHead}>
              <div className={styles.listTitle}>{t('tab.discover')}</div>
            </div>
            <div className={styles.discoverMenu}>
              <div className={styles.menu}>
                <button type="button" className={styles.menuBtn} data-on="true">
                  <span className={`${styles.discoverIcon} ${styles.discoverMoments}`}><IconCameraMini /></span>
                  {t('discoverTitle')}
                </button>
                <button type="button" className={styles.menuBtn} onClick={() => void addWorkspace(props)}>
                  <span className={`${styles.discoverIcon} ${styles.discoverScan}`}><IconScan /></span>
                  {t('discover.scan')}
                </button>
              </div>
              <p className={styles.sectionHint}>{t('discoverBody')}</p>
            </div>
            <div className={styles.momentsInColumn}>
              <MomentsFeed
                posts={moments}
                t={t}
                onOpen={openChat}
                onPost={() => props.startSession(recentWorkspaceId)}
              />
            </div>
          </>
        )}

        {tab === 'me' && (
          <>
            <MePanel
              t={t}
              sessionId={modelSessionId}
              directoryFor={props.directoryFor}
              saveDefaultModel={props.saveDefaultModel}
              onClassic={() => setEnabled(false)}
            />
          </>
        )}
      </aside>

      <section className={styles.chat}>
        {tab === 'discover' ? (
          <MomentsFeed
            posts={moments}
            t={t}
            onOpen={openChat}
            onPost={() => props.startSession(recentWorkspaceId)}
          />
        ) : tab !== 'chats' || !current ? (
          <div className={styles.paneEmpty}>
            <div className={styles.emptyMark}><WeChatMark /></div>
            <p>{workspaces.length === 0 ? t('noWorkspace') : t('emptyChat')}</p>
          </div>
        ) : (
          <>
            <header className={styles.chatHead}>
              <button type="button" className={styles.back} onClick={() => setMobileChat(false)}>{t('back')}</button>
              <Avatar id={current} title={title} />
              <div className={styles.chatHeadMeta}>
                <div className={styles.chatName}>{title}</div>
                {subtitle && <div className={styles.chatSub}>{subtitle}</div>}
              </div>
            </header>
            <Thread items={items} t={t} />
            <Composer
              t={t}
              running={Boolean(snapshot?.running)}
              disabled={Boolean(snapshot?.removed) || snapshot?.openState === 'error'}
              onSend={(text) => void sendPrompt(binding, text)}
              onStop={() => void binding?.session.cancel()}
            />
          </>
        )}
      </section>

      <nav className={styles.dock} aria-label={t('brand')}>
        <RailButton active={tab === 'chats'} label={t('tab.chats')} onClick={() => { setTab('chats'); setMobileChat(false) }}>
          <IconChat />
        </RailButton>
        <RailButton active={tab === 'contacts'} label={t('tab.contacts')} onClick={() => setTab('contacts')}>
          <IconPeople />
        </RailButton>
        <RailButton active={tab === 'discover'} label={t('tab.discover')} onClick={() => setTab('discover')}>
          <IconDiscover />
        </RailButton>
        <RailButton active={tab === 'me'} label={t('tab.me')} onClick={() => setTab('me')}>
          <IconMe />
        </RailButton>
      </nav>
    </div>,
  )
}

function toBody(node: ReactNode) {
  if (typeof document === 'undefined' || document.body === null) return node
  return createPortal(node, document.body)
}

function Thread({ items, t }: { items: WeChatItem[]; t: (key: WeChatKey) => string }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [items])

  if (items.length === 0) {
    return (
      <div className={styles.paneEmpty}>
        <div className={styles.emptyMark}><WeChatMark /></div>
        <p>{t('emptyChat')}</p>
      </div>
    )
  }

  return (
    <div className={styles.thread} ref={ref}>
      {items.map((item, index) => {
        if (item.kind === 'time') return <div key={item.id} className={styles.time}><span>{item.label}</span></div>
        if (item.kind === 'tip') return <div key={item.id} className={styles.tip}><span>{item.text}</span></div>
        if (item.kind === 'typing') {
          return (
            <div key="typing" className={styles.line}>
              <Avatar id="assistant" title="DS" />
              <div className={`${styles.bubble} ${styles.bubbleThem} ${styles.typing}`} aria-label={t('typing')}>
                <span className={styles.dot} />
                <span className={styles.dot} />
                <span className={styles.dot} />
              </div>
            </div>
          )
        }
        if (item.kind === 'approval') return <ApprovalCard key={item.id} item={item} t={t} />
        if (item.kind === 'question') return <QuestionCard key={item.id} item={item} t={t} />
        const mine = item.kind === 'me'
        const prev = items[index - 1]
        const tight = prev !== undefined && prev.kind === item.kind
        return (
          <div key={item.id} className={`${styles.line} ${mine ? styles.lineMe : ''} ${tight ? styles.lineTight : ''}`}>
            <Avatar id={mine ? 'me' : 'assistant'} title={mine ? '我' : 'DS'} />
            <div className={`${styles.bubble} ${mine ? styles.bubbleMe : styles.bubbleThem} ${item.kind === 'them' && item.streaming ? styles.streaming : ''}`}>
              {item.text}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ApprovalCard({ item, t }: { item: Extract<WeChatItem, { kind: 'approval' }>; t: (key: WeChatKey) => string }) {
  const wait = item.wait
  const payload = wait.payload as { toolName?: string; reason?: string; approvalId?: string }
  const [busy, setBusy] = useState(false)
  const answer = async (outcome: 'allowed-once' | 'rejected') => {
    setBusy(true)
    try {
      const receipt = await wait.respond({
        ok: true,
        value: {
          sessionId: wait.sessionId,
          approvalId: payload.approvalId,
          outcome,
        },
      })
      if (!receipt.accepted) throw new Error(receipt.reason)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>{t('approvalTitle')}</div>
      <div className={styles.cardBody}>{payload.reason || payload.toolName || 'tool'}</div>
      <div className={styles.cardActions}>
        <button type="button" className={styles.danger} disabled={busy} onClick={() => void answer('rejected')}>{t('reject')}</button>
        <button type="button" className={styles.primary} disabled={busy} onClick={() => void answer('allowed-once')}>{t('allow')}</button>
      </div>
    </div>
  )
}

function QuestionCard({ item, t }: { item: Extract<WeChatItem, { kind: 'question' }>; t: (key: WeChatKey) => string }) {
  const wait = item.wait
  const questions = ((wait.payload as { questions?: QuestionView[] }).questions ?? [])
  const [picks, setPicks] = useState<Record<string, string[]>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const toggle = (id: string, label: string, multi: boolean) => {
    setPicks((prev) => {
      const current = prev[id] ?? []
      if (multi) {
        return { ...prev, [id]: current.includes(label) ? current.filter((x) => x !== label) : [...current, label] }
      }
      return { ...prev, [id]: [label] }
    })
  }

  const submit = async () => {
    setBusy(true)
    try {
      const receipt = await wait.respond({
        ok: true,
        value: {
          sessionId: wait.sessionId,
          answer: {
            answers: questions.map((q) => ({
              id: q.id,
              selected: picks[q.id] ?? [],
              custom: custom[q.id] || undefined,
            })),
          },
        },
      })
      if (!receipt.accepted) throw new Error(receipt.reason)
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    setBusy(true)
    try {
      await wait.respond({
        ok: false,
        error: { code: 'cancelled', message: 'the user closed this question request', details: {} },
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>{t('questionTitle')}</div>
      {questions.map((q) => (
        <div key={q.id}>
          <div className={styles.cardBody}>{q.header ? `${q.header}\n${q.question}` : q.question}</div>
          {q.detail && <div className={styles.cardBody}>{q.detail}</div>}
          {(q.options ?? []).map((opt) => (
            <button
              key={opt.label}
              type="button"
              className={styles.choice}
              data-on={(picks[q.id] ?? []).includes(opt.label)}
              onClick={() => toggle(q.id, opt.label, Boolean(q.multiSelect))}
            >
              {opt.label}
            </button>
          ))}
          {(!q.options || q.options.length === 0) && (
            <input
              className={styles.search}
              style={{ margin: '8px 0 0', width: '100%' }}
              value={custom[q.id] ?? ''}
              onChange={(e) => setCustom((prev) => ({ ...prev, [q.id]: e.target.value }))}
              placeholder={t('composer')}
            />
          )}
        </div>
      ))}
      <div className={styles.cardActions}>
        <button type="button" className={styles.ghost} disabled={busy} onClick={() => void cancel()}>{t('questionCancel')}</button>
        <button type="button" className={styles.primary} disabled={busy} onClick={() => void submit()}>{t('questionSubmit')}</button>
      </div>
    </div>
  )
}

interface QuestionView {
  id: string
  question: string
  detail?: string
  header?: string
  options?: { label: string }[]
  multiSelect?: boolean
}

function Composer({ t, running, disabled, onSend, onStop }: {
  t: (key: WeChatKey) => string
  running: boolean
  disabled: boolean
  onSend: (text: string) => void
  onStop: () => void
}) {
  const [draft, setDraft] = useState('')
  const ready = draft.trim().length > 0 && !disabled

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    const text = draft.trim()
    if (!text || disabled) return
    setDraft('')
    onSend(text)
  }

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form className={styles.composer} onSubmit={submit}>
      <div className={styles.field}>
        <textarea
          className={styles.input}
          rows={2}
          value={draft}
          disabled={disabled}
          placeholder={t('composer')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
        />
      </div>
      <div className={styles.composerRow}>
        {running && (
          <button type="button" className={styles.ghost} onClick={onStop}>{t('stop')}</button>
        )}
        <button type="submit" className={`${styles.send} ${ready ? styles.sendReady : ''}`} disabled={!ready}>
          {t('send')}
        </button>
      </div>
    </form>
  )
}

async function sendPrompt(binding: SessionBinding | undefined, text: string) {
  if (!binding) return
  await binding.session.prompt([{ type: 'text', text }], 'queue')
}

async function addWorkspace(props: WeChatAppProps) {
  const path = await props.pickDirectory()
  if (!path) return
  const ws = await props.createWorkspace(path)
  const sessionId = await props.connectWorkspace(ws.workspaceId)
  props.open(sessionId)
}

async function openWorkspace(props: WeChatAppProps, id: WorkspaceId) {
  const sessionId = await props.connectWorkspace(id)
  props.open(sessionId)
}
