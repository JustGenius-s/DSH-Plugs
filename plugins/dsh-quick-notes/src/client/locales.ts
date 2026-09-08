export type QuickNoteKey =
  | 'nav'
  | 'searchPlaceholder'
  | 'searchEmpty'
  | 'searchNoMatch'
  | 'includeArchived'
  | 'scopeNotes'
  | 'scopeArchived'
  | 'emptyNotes'
  | 'untitled'
  | 'placeholder'
  | 'addTag'
  | 'removeTagNamed'
  | 'renameTag'
  | 'deleteTag'
  | 'confirmDeleteTag'
  | 'selectedCount'
  | 'pin'
  | 'unpin'
  | 'archive'
  | 'unarchive'
  | 'deleteNote'
  | 'more'
  | 'close'
  | 'cancel'
  | 'regenerate'
  | 'openCard'
  | 'newNote'
  | 'metadataFailed'
  | 'retryFailed'
  | 'retry'
  | 'retryAll'
  | 'enabled'
  | 'newNoteShortcut'
  | 'searchShortcut'
  | 'recordingShortcut'
  | 'metadataModel'
  | 'useDefaultModel'
  | 'filterTags'
  | 'filters'

export const zh: Record<QuickNoteKey, string> = {
  nav: '随手笔记',
  searchPlaceholder: '搜索标题、正文或标签',
  searchEmpty: '开始输入以搜索笔记',
  searchNoMatch: '没有匹配的笔记',
  includeArchived: '包含归档',
  scopeNotes: '笔记',
  scopeArchived: '归档',
  emptyNotes: '还没有笔记。',
  untitled: '无标题',
  placeholder: '随手记点什么…',
  addTag: '添加标签',
  removeTagNamed: '移除「{name}」',
  renameTag: '重命名',
  deleteTag: '删除标签',
  confirmDeleteTag: '删除标签「{name}」？笔记上的这个标签会被去掉。',
  selectedCount: '已选 {n} 条',
  pin: '置顶',
  unpin: '取消置顶',
  archive: '归档',
  unarchive: '取消归档',
  deleteNote: '删除',
  more: '更多',
  close: '收起',
  cancel: '取消',
  regenerate: '重新生成标题和标签',
  openCard: '打开',
  newNote: '新建',
  metadataFailed: '标题生成失败',
  retryFailed: '重试失败的 {n} 条',
  retry: '重试',
  retryAll: '全部重试',
  enabled: '启用随手笔记',
  newNoteShortcut: '新建便签',
  searchShortcut: '搜索笔记',
  recordingShortcut: '按下组合键',
  metadataModel: '标题与标签',
  useDefaultModel: '跟随 DSH 默认模型',
  filterTags: '标签',
  filters: '筛选',
}

export const en: Record<QuickNoteKey, string> = {
  nav: 'Quick notes',
  searchPlaceholder: 'Search title, body, or tags',
  searchEmpty: 'Start typing to search notes',
  searchNoMatch: 'No matching notes',
  includeArchived: 'Include archived',
  scopeNotes: 'Notes',
  scopeArchived: 'Archived',
  emptyNotes: 'No notes yet.',
  untitled: 'Untitled',
  placeholder: 'Jot something down…',
  addTag: 'Add tag',
  removeTagNamed: 'Remove “{name}”',
  renameTag: 'Rename',
  deleteTag: 'Delete tag',
  confirmDeleteTag: 'Delete the tag “{name}”? It will be removed from every note.',
  selectedCount: '{n} selected',
  pin: 'Pin',
  unpin: 'Unpin',
  archive: 'Archive',
  unarchive: 'Unarchive',
  deleteNote: 'Delete',
  more: 'More',
  close: 'Collapse',
  cancel: 'Cancel',
  regenerate: 'Regenerate title and tags',
  openCard: 'Open',
  newNote: 'New',
  metadataFailed: 'Title generation failed',
  retryFailed: 'Retry {n} failed',
  retry: 'Retry',
  retryAll: 'Retry all',
  enabled: 'Enable quick notes',
  newNoteShortcut: 'New note',
  searchShortcut: 'Search notes',
  recordingShortcut: 'Press a shortcut',
  metadataModel: 'Title and tags',
  useDefaultModel: 'Follow the DSH default model',
  filterTags: 'Tags',
  filters: 'Filter',
}
