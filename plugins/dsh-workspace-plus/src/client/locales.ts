/**
 * Locale keys for @just-genius/dsh-workspace-plus.
 *
 * Covers the two additive surfaces (the pinned area, the multi-folder binding
 * dialog) and the rows this plugin contributes to DSH's own Project and Session
 * menus. Copy for the official rows lives with DSH and is not duplicated here.
 */

/**
 * This plugin's translate function.
 *
 * `params` is optional and carries the `{name}` substitutions the official
 * locale service performs, which is what lets a time bucket reuse the official
 * helper without rebuilding its string.
 */
export type Translate = (key: WorkspacePlusKey, params?: Record<string, unknown>) => string

export type WorkspacePlusKey =
  // ── Pinned area ──
  | 'pins.title'
  | 'pins.empty'
  | 'pins.collapse'
  | 'pins.expand'
  // Trailing relative time on a session row. The BUCKETS come from the shared
  // helper the official rows use; these are only the words.
  | 'time.now'
  | 'time.minutes'
  | 'time.hours'
  | 'time.days'
  | 'time.months'
  | 'time.years'
  | 'row.waiting.approval'
  | 'row.waiting.planReview'
  | 'row.waiting.question'
  // ── Binding dialog ──
  | 'cancel'
  | 'primary'
  | 'setPrimary'
  | 'remove'
  | 'edit'
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
  // ── Settings ──
  | 'settings.title'
  | 'settings.group.trigger'
  | 'settings.group.surface'
  | 'settings.group.workspace'
  | 'settings.group.session'
  | 'settings.contextmenu'
  | 'settings.pinnedPanel'
  | 'settings.workspacePin'
  | 'settings.workspaceEditBinding'
  | 'settings.workspaceOpenExplorer'
  | 'settings.workspaceCopyPath'
  | 'settings.workspaceNewSession'
  | 'settings.sessionCopyReference'
  | 'settings.sessionExport'
  | 'settings.sessionOpenFolder'
  // ── Rows added to the official Project menu ──
  | 'menu.pin'
  | 'menu.pinSession'
  | 'menu.unpinSession'
  | 'menu.unpin'
  | 'menu.rename'
  | 'menu.renameSession'
  | 'menu.forkSession'
  | 'menu.archive'
  | 'menu.removeFromList'
  | 'menu.editBinding'
  | 'menu.openExplorer'
  | 'menu.copyPath'
  | 'menu.newSession'
  // ── Rows added to the official Session menu ──
  | 'menu.copyReference'
  | 'menu.export'
  | 'menu.exporting'
  | 'menu.openFolder'
  // ── Feedback ──
  | 'toast.referenceCopied'
  | 'toast.pathCopied'
  | 'toast.copyFailed'
  | 'toast.pinned'
  | 'toast.unpinned'
  | 'toast.failed'
  | 'toast.openFailed'
  | 'toast.exporting'
  | 'toast.exported'
  | 'toast.exportFailed'
  | 'toast.removed'
  | 'toast.archived'
  | 'toast.renameFailed'
  // Rename dialog
  | 'rename.title.workspace'
  | 'rename.title.session'
  | 'rename.save'
  // Removal confirmation
  | 'confirm.removeWorkspace'
  | 'archive.title'
  | 'archive.desc'
  | 'archive.action'
  | 'archive.activity'
  | 'archive.turn'
  | 'archive.subagents'
  | 'archive.jobs'
  | 'archive.schedules'
  | 'archive.other'

export const zh: Record<WorkspacePlusKey, string> = {
  'pins.title': '置顶',
  'pins.collapse': '折叠置顶',
  'pins.expand': '展开置顶',
  'time.now': '刚刚',
  'time.minutes': '{n}分钟',
  'time.hours': '{n}小时',
  'time.days': '{n}天',
  'time.months': '{n}个月',
  'time.years': '{n}年',
  'pins.empty': '还没有置顶内容。',
  'row.waiting.approval': '等待授权',
  'row.waiting.planReview': '等待确认计划',
  'row.waiting.question': '等待回答',
  cancel: '取消',
  primary: '主仓',
  setPrimary: '设为主仓',
  remove: '移除',
  edit: '编辑工作区',
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

  'settings.title': '工作区增强',
  'settings.group.trigger': '触发方式',
  'settings.group.surface': '界面',
  'settings.group.workspace': '工作区菜单新增',
  'settings.group.session': '会话菜单新增',
  'settings.contextmenu': '右键打开行菜单',
  'settings.pinnedPanel': '显示置顶区',
  'settings.workspacePin': '置顶 / 从置顶中移除',
  'settings.workspaceEditBinding': '编辑文件夹绑定',
  'settings.workspaceOpenExplorer': '在资源管理器中打开',
  'settings.workspaceCopyPath': '复制路径',
  'settings.workspaceNewSession': '新建会话',
  'settings.sessionCopyReference': '复制会话引用',
  'settings.sessionExport': '导出为 Markdown',
  'settings.sessionOpenFolder': '打开所在目录',

  'menu.pin': '置顶项目',
  'menu.pinSession': '置顶会话',
  'menu.unpinSession': '从置顶中移除',
  'menu.unpin': '从置顶中移除',
  'menu.rename': '重命名',
  'menu.renameSession': '重命名',
  'menu.forkSession': '分叉会话',
  'menu.archive': '归档会话',
  'menu.removeFromList': '删除工作区',
  'menu.editBinding': '编辑多文件夹…',
  'menu.openExplorer': '在资源管理器中打开',
  'menu.copyPath': '复制路径',
  'menu.newSession': '新建会话',
  'menu.copyReference': '复制会话引用',
  'menu.export': '导出为 Markdown',
  'menu.exporting': '正在导出…',
  'menu.openFolder': '打开所在目录',

  'toast.referenceCopied': '会话引用已复制',
  'toast.pathCopied': '路径已复制',
  'toast.copyFailed': '复制失败',
  'toast.pinned': '已置顶',
  'toast.unpinned': '已从置顶中移除',
  'toast.failed': '操作失败',
  'toast.openFailed': '打开失败',
  'toast.exporting': '正在导出会话…',
  'toast.exported': '已发起 Markdown 下载',
  'toast.exportFailed': '导出失败，请重试',
  'toast.removed': '工作区已删除',
  'toast.archived': '已归档',
  'toast.renameFailed': '重命名失败',
  'rename.title.workspace': '重命名工作区',
  'rename.title.session': '重命名会话',
  'rename.save': '保存',
  'confirm.removeWorkspace': '确定删除工作区「{title}」吗？目录和会话记录会保留在磁盘上。',
  'archive.title': '停止并归档此会话？',
  'archive.desc': '「{title}」仍有正在进行的工作。归档会先停止这些工作；之后可在侧栏「显示已归档」中恢复会话，被停止的工作不会自动继续。',
  'archive.action': '停止并归档',
  'archive.activity': '将被停止的工作',
  'archive.turn': '进行中的回合',
  'archive.subagents': '{n} 个运行中的子代理：{names}',
  'archive.jobs': '{n} 个后台任务：{names}',
  'archive.schedules': '{n} 个定时任务：{names}',
  'archive.other': '{n} 个 {kind}',

}

export const en: Record<WorkspacePlusKey, string> = {
  'pins.title': 'Pinned',
  'pins.collapse': 'Collapse pinned',
  'pins.expand': 'Expand pinned',
  'time.now': 'now',
  'time.minutes': '{n}min',
  'time.hours': '{n}h',
  'time.days': '{n}d',
  'time.months': '{n}mo',
  'time.years': '{n}y',
  'pins.empty': 'Nothing pinned yet.',
  'row.waiting.approval': 'Waiting for approval',
  'row.waiting.planReview': 'Waiting for plan review',
  'row.waiting.question': 'Waiting for an answer',
  cancel: 'Cancel',
  primary: 'Primary',
  setPrimary: 'Make primary',
  remove: 'Remove',
  edit: 'Edit workspace',
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

  'settings.title': 'Workspace Plus',
  'settings.group.trigger': 'Triggers',
  'settings.group.surface': 'Surfaces',
  'settings.group.workspace': 'Added to the workspace menu',
  'settings.group.session': 'Added to the session menu',
  'settings.contextmenu': 'Open the row menu on right click',
  'settings.pinnedPanel': 'Show the pinned area',
  'settings.workspacePin': 'Pin / remove from pinned',
  'settings.workspaceEditBinding': 'Edit folder binding',
  'settings.workspaceOpenExplorer': 'Open in file manager',
  'settings.workspaceCopyPath': 'Copy path',
  'settings.workspaceNewSession': 'New session',
  'settings.sessionCopyReference': 'Copy session reference',
  'settings.sessionExport': 'Export as Markdown',
  'settings.sessionOpenFolder': 'Open containing folder',

  'menu.pin': 'Pin project',
  'menu.pinSession': 'Pin session',
  'menu.unpinSession': 'Remove from pinned',
  'menu.unpin': 'Remove from pinned',
  'menu.rename': 'Rename',
  'menu.renameSession': 'Rename',
  'menu.forkSession': 'Fork session',
  'menu.archive': 'Archive session',
  'menu.removeFromList': 'Delete workspace',
  'menu.editBinding': 'Edit multi-folder…',
  'menu.openExplorer': 'Open in file manager',
  'menu.copyPath': 'Copy path',
  'menu.newSession': 'New session',
  'menu.copyReference': 'Copy session reference',
  'menu.export': 'Export as Markdown',
  'menu.exporting': 'Exporting…',
  'menu.openFolder': 'Open containing folder',

  'toast.referenceCopied': 'Reference copied',
  'toast.pathCopied': 'Path copied',
  'toast.copyFailed': 'Copy failed',
  'toast.pinned': 'Pinned',
  'toast.unpinned': 'Removed from pinned',
  'toast.failed': 'Action failed',
  'toast.openFailed': 'Open failed',
  'toast.exporting': 'Exporting session…',
  'toast.exported': 'Markdown download started',
  'toast.exportFailed': 'Export failed. Please try again.',
  'toast.removed': 'Workspace deleted',
  'toast.archived': 'Archived',
  'toast.renameFailed': 'Rename failed',
  'rename.title.workspace': 'Rename workspace',
  'rename.title.session': 'Rename session',
  'rename.save': 'Save',
  'confirm.removeWorkspace': 'Delete the workspace “{title}”? Its directory and session records stay on disk.',
  'archive.title': 'Stop and archive this session?',
  'archive.desc': '“{title}” still has work running. Archiving stops that work first; the session can be restored later from “Show archived” in the sidebar, but the stopped work will not resume.',
  'archive.action': 'Stop and archive',
  'archive.activity': 'Work that will be stopped',
  'archive.turn': 'A turn in progress',
  'archive.subagents': '{n} running subagent(s): {names}',
  'archive.jobs': '{n} background job(s): {names}',
  'archive.schedules': '{n} schedule(s): {names}',
  'archive.other': '{n} {kind}',

}
