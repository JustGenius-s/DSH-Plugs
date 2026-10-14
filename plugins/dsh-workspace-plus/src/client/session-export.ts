import { SESSION_EXPORT_PATH, type SessionExportPayload } from '../shared.ts'
import { postJson } from './http.ts'

export async function requestSessionExport(sessionId: string): Promise<SessionExportPayload> {
  const payload = await postJson<SessionExportPayload>(SESSION_EXPORT_PATH, { sessionId })
  if (payload === null || typeof payload !== 'object'
    || typeof payload.filename !== 'string' || payload.filename.trim() === ''
    || typeof payload.markdown !== 'string') {
    throw new Error('Invalid session export response')
  }
  return payload
}

export interface MarkdownDownloadDependencies {
  createObjectURL: (blob: Blob) => string
  startDownload: (filename: string, url: string) => void
  revokeObjectURL: (url: string) => void
  scheduleRelease: (release: () => void) => void
}

const browserDownload: MarkdownDownloadDependencies = {
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => { URL.revokeObjectURL(url) },
  // Give the webview time to start reading the URL before releasing its data.
  scheduleRelease: (release) => { setTimeout(release, 1_000) },
  startDownload: (filename, url) => {
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.style.display = 'none'
    document.body.appendChild(link)
    try {
      link.click()
    } finally {
      link.remove()
    }
  },
}

/** Keep browser resource ownership separate from fetching and menu state. */
export function downloadSessionMarkdown(
  payload: SessionExportPayload,
  deps: MarkdownDownloadDependencies = browserDownload,
): void {
  const blob = new Blob([payload.markdown], { type: 'text/markdown;charset=utf-8' })
  const url = deps.createObjectURL(blob)
  try {
    deps.startDownload(payload.filename, url)
    deps.scheduleRelease(() => { deps.revokeObjectURL(url) })
  } catch (error) {
    deps.revokeObjectURL(url)
    throw error
  }
}

export interface SessionExportDependencies {
  request: (sessionId: string) => Promise<SessionExportPayload>
  download: (payload: SessionExportPayload) => void | Promise<void>
}

/** One in-flight export per session, including when its menu is reopened. */
export function createSessionExporter(deps: SessionExportDependencies) {
  let pending: ReadonlySet<string> = new Set()
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  return {
    getPending: (): ReadonlySet<string> => pending,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async run(sessionId: string): Promise<boolean> {
      if (pending.has(sessionId)) return false
      pending = new Set(pending).add(sessionId)
      notify()
      try {
        const payload = await deps.request(sessionId)
        await deps.download(payload)
        return true
      } finally {
        const next = new Set(pending)
        next.delete(sessionId)
        pending = next
        notify()
      }
    },
  }
}

export const sessionExporter = createSessionExporter({
  request: requestSessionExport,
  download: downloadSessionMarkdown,
})
