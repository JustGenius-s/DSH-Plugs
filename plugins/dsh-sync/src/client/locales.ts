export type SyncKey =
  | 'nav'
  | 'title'
  | 'hint'
  | 'groupAccount'
  | 'groupSync'
  | 'groupStatus'
  | 'clientId'
  | 'clientIdHint'
  | 'clientIdPlaceholder'
  | 'saveClientId'
  | 'login'
  | 'logout'
  | 'loggedInAs'
  | 'notLoggedIn'
  | 'deviceCode'
  | 'openGithub'
  | 'waitingAuth'
  | 'cancelAuth'
  | 'push'
  | 'pull'
  | 'pushOk'
  | 'pullOk'
  | 'forcePull'
  | 'gist'
  | 'lastSynced'
  | 'localUpdated'
  | 'plugins'
  | 'pluginsSkipped'
  | 'pluginsUnchanged'
  | 'pluginsAdded'
  | 'pluginsRemoved'
  | 'pluginsFailed'
  | 'pluginCount'
  | 'pulledSettings'
  | 'needsRestart'
  | 'none'
  | 'loading'
  | 'busy'
  | 'progressCollect'
  | 'progressUpload'
  | 'progressDownload'
  | 'progressApply'
  | 'progressDone'
  | 'conflictTitle'
  | 'conflictBody'
  | 'copyCode'
  | 'copied'
  | 'detailSep'
  | 'listSep'

export const zh: Record<SyncKey, string> = {
  nav: '同步',
  title: '同步',
  hint: '用 GitHub 账号登录后，把已注册插件设置与 web 插件清单同步到私有 Gist，无需自建服务器。',
  groupAccount: '账号',
  groupSync: '同步',
  groupStatus: '状态',
  clientId: 'GitHub OAuth Client ID',
  clientIdHint: '在 GitHub → Settings → Developer settings → OAuth Apps 新建应用，启用 Device Flow，把 Client ID 填到这里。',
  clientIdPlaceholder: 'Iv1.xxxxxxxx',
  saveClientId: '保存',
  login: '登录 GitHub',
  logout: '退出登录',
  loggedInAs: '已登录',
  notLoggedIn: '未登录',
  deviceCode: '设备码',
  openGithub: '打开授权页',
  waitingAuth: '等待你在浏览器完成授权…',
  cancelAuth: '取消',
  push: '推送到云端',
  pull: '从云端拉取',
  pushOk: '已推送',
  pullOk: '已拉取',
  forcePull: '强制用云端覆盖本地',
  gist: 'Gist',
  lastSynced: '上次同步',
  localUpdated: '本地配置时间',
  plugins: '可同步插件',
  pluginsSkipped: '未纳入同步（本机路径）',
  pluginsUnchanged: '插件无变更',
  pluginsAdded: '新增 {names}',
  pluginsRemoved: '移除 {names}',
  pluginsFailed: '失败 {names}',
  pluginCount: '{count} 个插件',
  pulledSettings: '已应用插件设置',
  needsRestart: '插件有变更，请重启 DSH web 后生效。',
  none: '无',
  loading: '加载中…',
  busy: '处理中…',
  progressCollect: '正在收集配置与插件清单…',
  progressUpload: '正在上传到 Gist…',
  progressDownload: '正在从 Gist 下载…',
  progressApply: '正在写入本机并安装插件…',
  progressDone: '完成',
  conflictTitle: '检测到冲突',
  conflictBody: '本地与云端自上次同步后都有改动。强制拉取会覆盖本机已注册插件设置与可移植插件清单。',
  copyCode: '复制设备码',
  copied: '已复制',
  detailSep: '，',
  listSep: '、',
}

export const en: Record<SyncKey, string> = {
  nav: 'Sync',
  title: 'Sync',
  hint: 'Sign in with GitHub and sync registered plugin settings plus the web plugin list to a secret Gist — no self-hosted sync server.',
  groupAccount: 'Account',
  groupSync: 'Sync',
  groupStatus: 'Status',
  clientId: 'GitHub OAuth Client ID',
  clientIdHint: 'Create an OAuth App under GitHub → Settings → Developer settings, enable Device Flow, then paste the Client ID here.',
  clientIdPlaceholder: 'Iv1.xxxxxxxx',
  saveClientId: 'Save',
  login: 'Sign in with GitHub',
  logout: 'Sign out',
  loggedInAs: 'Signed in as',
  notLoggedIn: 'Not signed in',
  deviceCode: 'Device code',
  openGithub: 'Open authorization',
  waitingAuth: 'Waiting for you to authorize in the browser…',
  cancelAuth: 'Cancel',
  push: 'Push to cloud',
  pull: 'Pull from cloud',
  pushOk: 'Pushed',
  pullOk: 'Pulled',
  forcePull: 'Force overwrite local with cloud',
  gist: 'Gist',
  lastSynced: 'Last synced',
  localUpdated: 'Local config time',
  plugins: 'Portable plugins',
  pluginsSkipped: 'Skipped (local paths)',
  pluginsUnchanged: 'plugins unchanged',
  pluginsAdded: 'added {names}',
  pluginsRemoved: 'removed {names}',
  pluginsFailed: 'failed {names}',
  pluginCount: '{count} plugins',
  pulledSettings: 'Applied plugin settings',
  needsRestart: 'Plugin changes need a DSH web restart.',
  none: 'None',
  loading: 'Loading…',
  busy: 'Working…',
  progressCollect: 'Collecting settings and plugin list…',
  progressUpload: 'Uploading to Gist…',
  progressDownload: 'Downloading from Gist…',
  progressApply: 'Writing local files and installing plugins…',
  progressDone: 'Done',
  conflictTitle: 'Conflict detected',
  conflictBody: 'Both local and cloud changed since the last sync. Force pull overwrites registered plugin settings and the portable plugin list.',
  copyCode: 'Copy device code',
  copied: 'Copied',
  detailSep: ', ',
  listSep: ', ',
}
