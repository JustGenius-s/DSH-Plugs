// Native overlay page: poll Cua activity + frames. Loaded in a
// dshDesktop.overlays window, not in the main React tree.

import { OVERLAY_ID } from '../shared/config.ts'
import { pickActivity } from '../shared/cua-activity.ts'
import { ACTIVITY_PATH, FOCUS_PATH, FRAME_PATH } from '../shared/routes.ts'
import type { ActivityResponse, FrameResponse } from '../shared/types.ts'

interface OverlayDesktop {
  overlays?: { close(id: string): Promise<void> }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: 'no-store' })
  if (!res.ok) throw new Error(`${path} ${res.status}`)
  return (await res.json()) as T
}

async function postJson(path: string, body: unknown): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${path} ${res.status}`)
}

function boot(): void {
  const title = document.getElementById('title')
  const closeBtn = document.getElementById('close')
  const shot = document.getElementById('shot') as HTMLImageElement | null
  const empty = document.getElementById('empty')
  let sessionId = ''

  const showEmpty = (text: string): void => {
    if (title) title.textContent = '画中画'
    if (empty) {
      empty.textContent = text
      empty.style.display = 'block'
    }
    if (shot) shot.style.display = 'none'
  }

  const pull = async (): Promise<void> => {
    try {
      const activity = await getJson<ActivityResponse>(ACTIVITY_PATH)
      const chosen = pickActivity(activity.sessions)
      if (chosen === undefined || !chosen.active) {
        sessionId = ''
        showEmpty('等待 Computer Use 操作窗口…')
        return
      }
      sessionId = chosen.sessionId
      const body = await getJson<FrameResponse>(`${FRAME_PATH}?session=${encodeURIComponent(sessionId)}`)
      const frame = body.state?.frame
      if (frame === undefined || frame === null) {
        showEmpty('正在捕获窗口…')
        return
      }
      if (title) {
        const label = [frame.appName, frame.windowTitle].filter((part) => part !== '').join(' — ')
        title.textContent = label === '' ? '画中画' : label
      }
      if (empty) empty.style.display = 'none'
      if (shot) {
        shot.src = `data:${frame.mime};base64,${frame.base64}`
        shot.style.display = 'block'
      }
    } catch {
      showEmpty('画中画连接中…')
    }
  }

  closeBtn?.addEventListener('click', (event) => {
    event.stopPropagation()
    const desktop = (window as unknown as { dshDesktop?: OverlayDesktop }).dshDesktop
    void desktop?.overlays?.close(OVERLAY_ID)
    window.close()
  })

  shot?.addEventListener('click', () => {
    if (sessionId === '') return
    void postJson(FOCUS_PATH, { sessionId })
  })

  void pull()
  window.setInterval(() => void pull(), 1000)
}

boot()
