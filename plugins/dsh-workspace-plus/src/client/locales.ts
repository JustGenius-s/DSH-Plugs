/**
 * Locale keys for @just-genius/dsh-workspace-plus.
 *
 * Two groups: the multi-folder binding dialog inherited from the
 * multi-folder workspace picker, and the row-menu actions merged in from
 * dsh-workspace-menu v1.2.0.
 */
export type WorkspacePlusKey =
  // ── Binding dialog ──
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
  // ── Settings ──
  | 'settings.title'
  | 'settings.group.trigger'
  | 'settings.group.workspace'
  | 'settings.group.session'
  | 'settings.dblclick'
  | 'settings.contextmenu'
  | 'settings.workspacePin'
  | 'settings.workspaceRename'
  | 'settings.workspaceOpenExplorer'
  | 'settings.workspaceCopyPath'
  | 'settings.workspaceNewSession'
  | 'settings.workspaceDelete'
  | 'settings.sessionPin'
  | 'settings.sessionRename'
  | 'settings.sessionUnread'
  | 'settings.sessionArchive'
  | 'settings.sessionFork'
  | 'settings.sessionCopyLink'
  | 'settings.sessionCopyTitle'
  | 'settings.sessionOpenWindow'
  | 'settings.sessionOpenFolder'
  // ── Workspace row menu ──
  | 'menu.pin'
  | 'menu.unpin'
  | 'menu.rename'
  | 'menu.openExplorer'
  | 'menu.copyPath'
  | 'menu.newSession'
  | 'menu.removeFromList'
  | 'menu.renameWorkspace'
  // ── Session row menu ──
  | 'menu.markUnread'
  | 'menu.markRead'
  | 'menu.archive'
  | 'menu.fork'
  | 'menu.copyLink'
  | 'menu.copyTitle'
  | 'menu.openWindow'
  | 'menu.openFolder'
  | 'menu.renameSession'
  // ── Feedback ──
  | 'toast.pinned'
  | 'toast.unpinned'
  | 'toast.markedUnread'
  | 'toast.markedRead'
  | 'toast.pathCopied'
  | 'toast.linkCopied'
  | 'toast.titleCopied'
  | 'toast.copyFailed'
  | 'toast.removed'
  | 'toast.archived'
  | 'toast.renamed'
  | 'toast.failed'
  | 'toast.openFailed'
  | 'toast.removeFailed'
  | 'toast.archiveFailed'
  | 'toast.forkFailed'
  | 'toast.renameFailed'
  | 'confirm.removeWorkspace'

export const zh: Record<WorkspacePlusKey, string> = {
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

  'settings.title': '工作区增强',
  'settings.group.trigger': '触发方式',
  'settings.group.workspace': '工作区功能',
  'settings.group.session': '会话功能',
  'settings.dblclick': '双击打开菜单',
  'settings.contextmenu': '右键打开菜单',
  'settings.workspacePin': '置顶 / 取消置顶',
  'settings.workspaceRename': '重命名',
  'settings.workspaceOpenExplorer': '在资源管理器中打开',
  'settings.workspaceCopyPath': '复制路径',
  'settings.workspaceNewSession': '新建会话',
  'settings.workspaceDelete': '从列表中移除',
  'settings.sessionPin': '置顶 / 取消置顶',
  'settings.sessionRename': '重命名',
  'settings.sessionUnread': '标记未读 / 已读',
  'settings.sessionArchive': '归档会话',
  'settings.sessionFork': '分叉会话',
  'settings.sessionCopyLink': '复制链接',
  'settings.sessionCopyTitle': '复制标题',
  'settings.sessionOpenWindow': '在新窗口中打开',
  'settings.sessionOpenFolder': '打开所在目录',

  'menu.pin': '置顶',
  'menu.unpin': '取消置顶',
  'menu.rename': '重命名',
  'menu.openExplorer': '在资源管理器中打开',
  'menu.copyPath': '复制路径',
  'menu.newSession': '新建会话',
  'menu.removeFromList': '从列表中移除',
  'menu.renameWorkspace': '重命名工作区',
  'menu.markUnread': '标记为未读',
  'menu.markRead': '标记为已读',
  'menu.archive': '归档会话',
  'menu.fork': '分叉会话',
  'menu.copyLink': '复制会话链接',
  'menu.copyTitle': '复制会话标题',
  'menu.openWindow': '在新窗口中打开',
  'menu.openFolder': '打开所在目录',
  'menu.renameSession': '重命名会话',

  'toast.pinned': '已置顶',
  'toast.unpinned': '已取消置顶',
  'toast.markedUnread': '已标记为未读',
  'toast.markedRead': '已标记为已读',
  'toast.pathCopied': '路径已复制',
  'toast.linkCopied': '链接已复制',
  'toast.titleCopied': '标题已复制',
  'toast.copyFailed': '复制失败',
  'toast.removed': '已从列表中移除',
  'toast.archived': '已归档',
  'toast.renamed': '已重命名',
  'toast.failed': '操作失败',
  'toast.openFailed': '打开失败',
  'toast.removeFailed': '移除失败',
  'toast.archiveFailed': '归档失败',
  'toast.forkFailed': '分叉失败',
  'toast.renameFailed': '重命名失败',
  'confirm.removeWorkspace': '确定从 DSH 工作区列表中移除「{title}」吗？\n目录和会话记录会保留在磁盘上。',
}

export const en: Record<WorkspacePlusKey, string> = {
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

  'settings.title': 'Workspace Plus',
  'settings.group.trigger': 'Triggers',
  'settings.group.workspace': 'Workspace actions',
  'settings.group.session': 'Session actions',
  'settings.dblclick': 'Open menu on double click',
  'settings.contextmenu': 'Open menu on right click',
  'settings.workspacePin': 'Pin / unpin',
  'settings.workspaceRename': 'Rename',
  'settings.workspaceOpenExplorer': 'Open in file manager',
  'settings.workspaceCopyPath': 'Copy path',
  'settings.workspaceNewSession': 'New session',
  'settings.workspaceDelete': 'Remove from list',
  'settings.sessionPin': 'Pin / unpin',
  'settings.sessionRename': 'Rename',
  'settings.sessionUnread': 'Mark unread / read',
  'settings.sessionArchive': 'Archive session',
  'settings.sessionFork': 'Fork session',
  'settings.sessionCopyLink': 'Copy link',
  'settings.sessionCopyTitle': 'Copy title',
  'settings.sessionOpenWindow': 'Open in new window',
  'settings.sessionOpenFolder': 'Open containing folder',

  'menu.pin': 'Pin',
  'menu.unpin': 'Unpin',
  'menu.rename': 'Rename',
  'menu.openExplorer': 'Open in file manager',
  'menu.copyPath': 'Copy path',
  'menu.newSession': 'New session',
  'menu.removeFromList': 'Remove from list',
  'menu.renameWorkspace': 'Rename workspace',
  'menu.markUnread': 'Mark as unread',
  'menu.markRead': 'Mark as read',
  'menu.archive': 'Archive session',
  'menu.fork': 'Fork session',
  'menu.copyLink': 'Copy session link',
  'menu.copyTitle': 'Copy session title',
  'menu.openWindow': 'Open in new window',
  'menu.openFolder': 'Open containing folder',
  'menu.renameSession': 'Rename session',

  'toast.pinned': 'Pinned',
  'toast.unpinned': 'Unpinned',
  'toast.markedUnread': 'Marked as unread',
  'toast.markedRead': 'Marked as read',
  'toast.pathCopied': 'Path copied',
  'toast.linkCopied': 'Link copied',
  'toast.titleCopied': 'Title copied',
  'toast.copyFailed': 'Copy failed',
  'toast.removed': 'Removed from list',
  'toast.archived': 'Archived',
  'toast.renamed': 'Renamed',
  'toast.failed': 'Action failed',
  'toast.openFailed': 'Open failed',
  'toast.removeFailed': 'Remove failed',
  'toast.archiveFailed': 'Archive failed',
  'toast.forkFailed': 'Fork failed',
  'toast.renameFailed': 'Rename failed',
  'confirm.removeWorkspace': 'Remove “{title}” from the DSH workspace list?\nIts directory and session records stay on disk.',
}
