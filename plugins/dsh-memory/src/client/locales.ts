export type MemoryKey =
  | 'nav'
  | 'hint'
  | 'search'
  | 'loading'
  | 'empty'
  | 'emptySearch'
  | 'add'
  | 'edit'
  | 'delete'
  | 'save'
  | 'cancel'
  | 'saving'
  | 'retry'
  | 'expand'
  | 'collapse'
  | 'title'
  | 'content'
  | 'enabled'
  | 'disabled'
  | 'source'
  | 'source.manual'
  | 'source.ai'
  | 'updated'
  | 'root'
  | 'loadFailed'
  | 'saveFailed'
  | 'confirmDelete'
  | 'propose.title'
  | 'propose.accept'
  | 'propose.reject'
  | 'propose.editHint'

export const zh: Record<MemoryKey, string> = {
  nav: '记忆',
  hint: '全局记忆以 Markdown 保存在本机，启用后会注入到后续对话的系统提示。',
  search: '搜索记忆',
  loading: '读取记忆…',
  empty: '还没有记忆。可以手动添加，或让 AI 调用 memory_propose 后在对话里确认。',
  emptySearch: '没有匹配的记忆。',
  add: '新增记忆',
  edit: '编辑',
  delete: '删除',
  save: '保存',
  cancel: '取消',
  saving: '保存中…',
  retry: '重试',
  expand: '展开',
  collapse: '收起',
  title: '标题',
  content: '内容（Markdown）',
  enabled: '启用',
  disabled: '停用',
  source: '来源',
  'source.manual': '手动',
  'source.ai': 'AI',
  updated: '更新时间',
  root: '存储目录',
  loadFailed: '读取失败',
  saveFailed: '保存失败',
  confirmDelete: '确定删除这条记忆？',
  'propose.title': '写入记忆确认',
  'propose.accept': '接受',
  'propose.reject': '拒绝',
  'propose.editHint': '可直接改标题与内容后再接受',
}

export const en: Record<MemoryKey, string> = {
  nav: 'Memory',
  hint: 'Global memories are stored as Markdown on disk. Enabled entries are injected into the system prompt.',
  search: 'Search memories',
  loading: 'Loading memories…',
  empty: 'No memories yet. Add one manually, or let the AI call memory_propose and confirm in chat.',
  emptySearch: 'No matching memories.',
  add: 'Add memory',
  edit: 'Edit',
  delete: 'Delete',
  save: 'Save',
  cancel: 'Cancel',
  saving: 'Saving…',
  retry: 'Retry',
  expand: 'Expand',
  collapse: 'Collapse',
  title: 'Title',
  content: 'Content (Markdown)',
  enabled: 'Enabled',
  disabled: 'Off',
  source: 'Source',
  'source.manual': 'Manual',
  'source.ai': 'AI',
  updated: 'Updated',
  root: 'Storage folder',
  loadFailed: 'Failed to load',
  saveFailed: 'Failed to save',
  confirmDelete: 'Delete this memory?',
  'propose.title': 'Confirm memory write',
  'propose.accept': 'Accept',
  'propose.reject': 'Reject',
  'propose.editHint': 'Edit the title or body before accepting',
}
