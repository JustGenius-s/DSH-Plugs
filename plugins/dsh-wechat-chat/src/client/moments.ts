import type { ConversationSnapshot, SessionId, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import type { Translate } from './project.ts'
import { projectChat, type WeChatItem } from './project.ts'

export type MomentMood = 'live' | 'needYou' | 'done' | 'idle'

export interface MomentPost {
  id: string
  sessionId: SessionId
  name: string
  time: number
  prompt: string
  text: string
  chips: string[]
  mood: MomentMood
}

function lastText(items: WeChatItem[], kind: 'me' | 'them' | 'tip'): { text: string; time: number } | undefined {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]
    if (item.kind !== kind) continue
    return { text: item.text, time: item.kind === 'me' || item.kind === 'them' ? item.time : 0 }
  }
  return undefined
}

function lastTips(items: WeChatItem[], limit: number): string[] {
  const tips: string[] = []
  for (let i = items.length - 1; i >= 0 && tips.length < limit; i -= 1) {
    const item = items[i]
    if (item.kind === 'tip') tips.unshift(item.text)
  }
  return tips
}

function moodOf(row: SessionSummary): MomentMood {
  if (row.pendingInteraction) return 'needYou'
  if (row.running) return 'live'
  if (row.completed) return 'done'
  return 'idle'
}

function fallbackText(mood: MomentMood, t: Translate, title: string): string {
  if (mood === 'live') return t('preview.typing')
  if (mood === 'needYou') return t('preview.needYou')
  if (mood === 'done') return t('preview.done')
  return title
}

export function projectMoments(
  rows: readonly SessionSummary[],
  snapshots: Readonly<Record<string, ConversationSnapshot | undefined>>,
  t: Translate,
): MomentPost[] {
  const posts: MomentPost[] = []
  for (const row of rows) {
    if (!row || row.blank || row.origin === 'subagent') continue
    const items = projectChat(snapshots[row.id], t)
    const them = lastText(items, 'them')
    const me = lastText(items, 'me')
    const tip = lastText(items, 'tip')
    const mood = moodOf(row)
    const text = (them?.text || tip?.text || fallbackText(mood, t, row.displayTitle)).replace(/\s+/g, ' ').trim()
    const time = them?.time || me?.time || row.updatedAt
    posts.push({
      id: row.id,
      sessionId: row.id,
      name: row.displayTitle,
      time,
      prompt: (me?.text ?? '').replace(/\s+/g, ' ').trim(),
      text,
      chips: lastTips(items, 3),
      mood,
    })
  }
  return posts.sort((a, b) => b.time - a.time).slice(0, 30)
}
