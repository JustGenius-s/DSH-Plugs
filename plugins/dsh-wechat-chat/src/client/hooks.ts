import { useEffect, useState } from 'react'
import type { ConversationSnapshot, SessionBinding, SessionFace } from '@deepseek-ai/dsh-client-runtime/client'

const ENABLED_KEY = 'dsh-wechat-chat.enabled'

export function readEnabled(): boolean {
  if (typeof localStorage === 'undefined') return true
  const value = localStorage.getItem(ENABLED_KEY)
  return value !== '0'
}

export function writeEnabled(enabled: boolean) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0')
}

export function useWeChatEnabled(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = useState(readEnabled)
  useEffect(() => {
    writeEnabled(enabled)
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.wechatSkin = enabled ? 'on' : 'off'
    }
  }, [enabled])
  return [enabled, setEnabled]
}

export function useLiveSnapshot(session: SessionFace | undefined): ConversationSnapshot | undefined {
  const [snapshot, setSnapshot] = useState<ConversationSnapshot | undefined>(() => session?.getSnapshot())
  useEffect(() => {
    if (!session) {
      setSnapshot(undefined)
      return
    }
    setSnapshot(session.getSnapshot())
    return session.subscribe(() => setSnapshot(session.getSnapshot()))
  }, [session])
  return snapshot
}

export function useRecentSnapshots(
  ids: readonly string[],
  resolve: (id: string) => SessionBinding | undefined,
): Readonly<Record<string, ConversationSnapshot | undefined>> {
  const key = ids.slice(0, 12).join('\n')
  const [map, setMap] = useState<Record<string, ConversationSnapshot | undefined>>({})
  useEffect(() => {
    const target = key.length === 0 ? [] : key.split('\n')
    const pull = () => {
      const next: Record<string, ConversationSnapshot | undefined> = {}
      for (const id of target) next[id] = resolve(id)?.session.getSnapshot()
      setMap((prev) => {
        if (target.length === Object.keys(prev).length && target.every((id) => prev[id] === next[id])) return prev
        return next
      })
    }
    pull()
    const unsubs = target
      .map((id) => resolve(id)?.session.subscribe(pull))
      .filter((fn): fn is () => void => typeof fn === 'function')
    const timer = window.setInterval(pull, 800)
    return () => {
      for (const fn of unsubs) fn()
      window.clearInterval(timer)
    }
  }, [key, resolve])
  return map
}

export function useBinding(
  sessionId: string | undefined,
  resolve: (id: string) => SessionBinding | undefined,
): SessionBinding | undefined {
  const [binding, setBinding] = useState(() => sessionId ? resolve(sessionId) : undefined)
  useEffect(() => {
    if (!sessionId) {
      setBinding(undefined)
      return
    }
    setBinding(resolve(sessionId))
    const timer = window.setInterval(() => {
      const next = resolve(sessionId)
      setBinding((prev) => prev === next ? prev : next)
    }, 400)
    return () => window.clearInterval(timer)
  }, [sessionId, resolve])
  return binding
}
