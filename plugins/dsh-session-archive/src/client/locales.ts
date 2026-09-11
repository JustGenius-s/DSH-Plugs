export type ArchiveKey =
  | 'nav'
  | 'loading'
  | 'empty'
  | 'emptyGroup'
  | 'ungrouped'
  | 'delete'
  | 'confirmDelete'
  | 'cancel'
  | 'retry'
  | 'loadFailed'
  | 'deleteFailed'
  | 'updated'
  | 'path'

export const zh: Record<ArchiveKey, string> = {
  nav: '会话归档',
  loading: '读取归档会话…',
  empty: '还没有归档会话。',
  emptyGroup: '该工作区没有归档会话。',
  ungrouped: '未分组',
  delete: '删除',
  confirmDelete: '确定永久删除这条会话？此操作不可恢复。',
  cancel: '取消',
  retry: '重试',
  loadFailed: '读取失败',
  deleteFailed: '删除失败',
  updated: '更新时间',
  path: '路径',
}

export const en: Record<ArchiveKey, string> = {
  nav: 'Session archive',
  loading: 'Loading archived sessions…',
  empty: 'No archived sessions.',
  emptyGroup: 'No archived sessions in this workspace.',
  ungrouped: 'Ungrouped',
  delete: 'Delete',
  confirmDelete: 'Permanently delete this session? This cannot be undone.',
  cancel: 'Cancel',
  retry: 'Retry',
  loadFailed: 'Failed to load',
  deleteFailed: 'Failed to delete',
  updated: 'Updated',
  path: 'Path',
}
