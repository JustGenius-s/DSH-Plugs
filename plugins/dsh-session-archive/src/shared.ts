export const LIST_PATH = '/dsh-session-archive/list'
export const DELETE_PATH = '/dsh-session-archive/delete'

export interface ArchiveHttpOk<T> {
  ok: true
  value: T
}

export interface ArchiveHttpErr {
  ok: false
  message: string
}

export type ArchiveHttpResult<T> = ArchiveHttpOk<T> | ArchiveHttpErr

export interface ArchivedSessionRow {
  id: string
  title: string
  updatedAt: number | null
  workspaceId: string | null
  workspaceTitle: string
  workspacePath: string | null
}

export interface ArchiveListPayload {
  sessions: ArchivedSessionRow[]
}

export interface ArchiveDeleteRequest {
  sessionId: string
}
