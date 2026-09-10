export type MultiRepoKey =
  | 'cancel'
  | 'primary'
  | 'setPrimary'
  | 'remove'
  | 'edit'
  | 'row.running'
  | 'modal.title.pick'
  | 'modal.title.edit'
  | 'modal.titleLabel'
  | 'modal.titlePlaceholder'
  | 'modal.add'
  | 'modal.openWorkspace'
  | 'modal.save'
  | 'modal.none'
  | 'modal.needPrimary'
  | 'modal.busy'
  | 'modal.empty'

export const zh: Record<MultiRepoKey, string> = {
  cancel: '取消',
  primary: '主仓',
  setPrimary: '设为主仓',
  remove: '移除',
  edit: '编辑工作区',
  'row.running': '有会话进行中',
  'modal.title.pick': '添加工作区',
  'modal.title.edit': '编辑工作区',
  'modal.titleLabel': '显示名称',
  'modal.titlePlaceholder': '项目名',
  'modal.add': '添加文件夹',
  'modal.openWorkspace': '打开工作区',
  'modal.save': '保存',
  'modal.none': '至少添加一个文件夹。',
  'modal.needPrimary': '请指定一个主仓。',
  'modal.busy': '正在保存…',
  'modal.empty': '还没有文件夹。点「添加文件夹」选择一个目录。',
}

export const en: Record<MultiRepoKey, string> = {
  cancel: 'Cancel',
  primary: 'Primary',
  setPrimary: 'Make primary',
  remove: 'Remove',
  edit: 'Edit workspace',
  'row.running': 'A session is in progress',
  'modal.title.pick': 'Add workspace',
  'modal.title.edit': 'Edit workspace',
  'modal.titleLabel': 'Display name',
  'modal.titlePlaceholder': 'Project name',
  'modal.add': 'Add folder',
  'modal.openWorkspace': 'Open workspace',
  'modal.save': 'Save',
  'modal.none': 'Add at least one folder.',
  'modal.needPrimary': 'Choose a primary folder.',
  'modal.busy': 'Saving…',
  'modal.empty': 'No folders yet. Click “Add folder” to choose a directory.',
}
