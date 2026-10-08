// Computer Use visual-verification PiP.
//
// The agent explicitly opens a session preview; this surface displays it
// only over the current conversation. Host capture continues across navigation.

import { createElement } from 'react'
import type { ClientContext } from '@just-genius/dsh-plugin-runtime/client'
import { CLIENT_SERVICES, getSessions } from '@just-genius/dsh-plugin-runtime/client'
import { OVERLAY_ID } from '../shared/config.ts'
import { resolveCurrentSessionId } from '../shared/cua-activity.ts'
import { desktop } from './desktop.ts'
import { FloatLayer, modulePlacements } from './float.tsx'
import { moduleRetained } from './panel.tsx'
import { pruneRetained } from './panel-state.ts'

interface SessionListFace {
  readonly list: {
    getSnapshot(): { byId: Record<string, unknown>; current?: string }
    subscribe(listener: () => void): () => void
  }
}

export const name = 'dsh-cua-pip'
export const inject = [
  CLIENT_SERVICES.slots,
  CLIENT_SERVICES.locale,
  CLIENT_SERVICES.sessions,
] as const

const NS = 'cua-pip'

const zh = {
  'view.title': '画中画',
  'panel.empty': '正在捕获窗口…',
  'panel.loadFailed': '窗口列表加载失败',
  'panel.close': '关闭',
  'panel.focusFailed': '暂时无法切换到应用',
  'panel.interrupted': '画面更新中断',
  'panel.reconnecting': '正在重连…',
  'panel.recovering': '正在恢复窗口录制…',
  'panel.captureStopped': '窗口录制已停止',
  'panel.captureFailed': '窗口录制不可用',
  'panel.permissionDenied': '需要窗口录制权限',
}

const en: Record<keyof typeof zh, string> = {
  'view.title': 'Picture in Picture',
  'panel.empty': 'Capturing the window…',
  'panel.loadFailed': 'Failed to load the window list',
  'panel.close': 'Close',
  'panel.focusFailed': 'Unable to focus the application',
  'panel.interrupted': 'Preview updates interrupted',
  'panel.reconnecting': 'Reconnecting…',
  'panel.recovering': 'Recovering window recording…',
  'panel.captureStopped': 'Window recording stopped',
  'panel.captureFailed': 'Window recording unavailable',
  'panel.permissionDenied': 'Window recording permission required',
}

function closeLeftoverNativeOverlay(): () => void {
  const overlays = desktop()?.overlays
  if (overlays === undefined) return () => {}
  void overlays.close(OVERLAY_ID).catch(() => {})
  return () => {}
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, 'zh', zh), 'dsh-cua-pip: zh dictionary')
  ctx.effect(() => ctx.locale.register(NS, 'en', en), 'dsh-cua-pip: en dictionary')

  const t = ctx.locale.bind(NS)
  const sessions = getSessions(ctx) as unknown as SessionListFace
  const getCurrentSessionId = (): string | undefined =>
    resolveCurrentSessionId(
      (sessions.list.getSnapshot() as { current?: unknown }).current,
      window.localStorage.getItem('dsh.sessions.current'),
    )
  const subscribeCurrentSession = (listener: () => void): (() => void) => sessions.list.subscribe(listener)

  ctx.effect(() => closeLeftoverNativeOverlay(), 'dsh-cua-pip: close leftover native overlay')

  ctx.effect(
    () =>
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'dsh-cua-pip',
            order: 85,
          },
          (() =>
            createElement(FloatLayer, {
              t,
              getCurrentSessionId,
              subscribeCurrentSession,
            })) as never,
        ),
      ),
    'dsh-cua-pip: conversation float',
  )

  ctx.effect(
    () =>
      sessions.list.subscribe(() => {
        const { byId } = sessions.list.getSnapshot()
        pruneRetained(moduleRetained, (sessionId) => sessionId in byId)
        for (const sessionId of modulePlacements.keys()) {
          if (!(sessionId in byId)) modulePlacements.delete(sessionId)
        }
      }),
    'dsh-cua-pip: retained-target prune',
  )
}
