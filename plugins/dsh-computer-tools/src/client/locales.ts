export type ComputerToolsKey =
  | 'nav'
  | 'loading'
  | 'retry'
  | 'loadFailed'
  | 'save'
  | 'discard'
  | 'saving'
  | 'unsaved'
  | 'enabled'
  | 'browser'
  | 'browserPurpose'
  | 'computer'
  | 'computerPurpose'
  | 'provider'
  | 'mode'
  | 'launch'
  | 'attach'
  | 'headless'
  | 'executablePath'
  | 'endpoint'
  | 'command'
  | 'args'
  | 'cuaNative'
  | 'cuaMcp'
  | 'advanced'
  | 'status.active'
  | 'status.pendingRestart'
  | 'status.configured'
  | 'status.missingDeps'
  | 'status.failed'
  | 'status.unknown'
  | 'missingPackages'
  | 'installNow'
  | 'installing'
  | 'installFailed'
  | 'installedRestart'
  | 'copyInstall'
  | 'copied'
  | 'restart'
  | 'relaunch'
  | 'permAccessibility'
  | 'permScreenRecording'
  | 'permGranted'
  | 'permDenied'
  | 'permUnknown'
  | 'restartDriver'
  | 'restartingDriver'
  | 'permissionDeniedHint'
  | 'permissionStaleHint'
  | 'permOpenSettings'
  | 'invalidEndpoint'
  | 'invalidCommand'
  | 'diagBrowserExecutable'
  | 'diagMcpCommand'
  | 'diagBrowserDuplicate'
  | 'diagComputerDuplicate'
  | 'diagCuaApp'
  | 'diagCuaBin'
  | 'diagCuaToolchain'
  | 'diagCuaProbe'
  | 'takeoverTitle'
  | 'takeoverDescription'
  | 'takeoverAck'
  | 'nativeTitle'
  | 'nativeDescription'
  | 'nativeAck'
  | 'confirm'
  | 'cancel'

export const zh: Record<ComputerToolsKey, string> = {
  nav: '浏览器与桌面',
  loading: '读取配置…',
  retry: '重试',
  loadFailed: '读取失败',
  save: '保存',
  discard: '放弃',
  saving: '保存中…',
  unsaved: '未保存',
  enabled: '启用',
  browser: '浏览器操作',
  browserPurpose: '让 AI 打开网页、点击、填表',
  computer: '桌面操作',
  computerPurpose: '让 AI 看屏幕、动鼠标键盘，操作这台电脑',
  provider: '提供方',
  mode: '模式',
  launch: '启动新浏览器',
  attach: '连接已有浏览器',
  headless: '无头（不显示窗口）',
  executablePath: '浏览器路径',
  endpoint: '调试地址',
  command: '命令',
  args: '参数',
  cuaMcp: 'Cua MCP',
  cuaNative: 'Cua Native',
  advanced: '高级选项',
  'status.active': '运行中',
  'status.pendingRestart': '已保存，重启后生效',
  'status.configured': '已开启',
  'status.missingDeps': '缺少组件',
  'status.failed': '出错了',
  'status.unknown': '读取中…',
  missingPackages: '还需要安装：',
  installNow: '一键安装',
  installing: '正在安装…',
  installFailed: '安装失败：',
  installedRestart: '已安装。保存后重启生效。',
  copyInstall: '复制命令',
  copied: '已复制',
  restart: '配置已写入，重启后新会话才会生效。',
  relaunch: '重启应用',
  permAccessibility: '辅助功能',
  permScreenRecording: '屏幕录制',
  permGranted: '已授权',
  permDenied: '被拒绝',
  permUnknown: '未决定',
  restartDriver: '重启驱动',
  restartingDriver: '重启中…',
  permissionDeniedHint: '在系统设置里勾选后回到这里点「重启驱动」——权限只对新启动的进程生效。',
  permissionStaleHint: '权限还没生效？驱动比授权早启动时需要重启一次。',
  permOpenSettings: '去设置',
  invalidEndpoint: '连接模式需要填写调试地址',
  invalidCommand: '需要填写命令',
  diagBrowserExecutable: '浏览器路径不存在：',
  diagMcpCommand: '命令不存在：',
  diagBrowserDuplicate: '浏览器有多个提供方：',
  diagComputerDuplicate: '桌面有多个提供方：',
  diagCuaApp: '未安装 Cua Driver：',
  diagCuaBin: '找不到命令：',
  diagCuaToolchain: '桌面工具调用失败：',
  diagCuaProbe: '驱动状态检查失败：',
  takeoverTitle: '替换现有配置',
  takeoverDescription: '配置里已有手写的浏览器 / 桌面条目。保存会用本页的选择替换它们。',
  takeoverAck: '我了解现有条目会被替换',
  nativeTitle: '启用 Cua Native',
  nativeDescription: 'Native 在 DSH 进程内运行，权限记在 DSH-Desktop 上；崩溃可能影响宿主。',
  nativeAck: '我了解 Native 的权限与崩溃风险',
  confirm: '继续',
  cancel: '取消',
}

export const en: Record<ComputerToolsKey, string> = {
  nav: 'Browser & Desktop',
  loading: 'Loading configuration…',
  retry: 'Retry',
  loadFailed: 'Failed to load',
  save: 'Save',
  discard: 'Discard',
  saving: 'Saving…',
  unsaved: 'Unsaved',
  enabled: 'Enabled',
  browser: 'Browser',
  browserPurpose: 'Let AI open pages, click, and fill forms',
  computer: 'Desktop',
  computerPurpose: 'Let AI see the screen and drive this computer',
  provider: 'Provider',
  mode: 'Mode',
  launch: 'Launch a new browser',
  attach: 'Attach to a running browser',
  headless: 'Headless (no window)',
  executablePath: 'Browser path',
  endpoint: 'Debug endpoint',
  command: 'Command',
  args: 'Arguments',
  cuaMcp: 'Cua MCP',
  cuaNative: 'Cua Native',
  advanced: 'Advanced options',
  'status.active': 'Running',
  'status.pendingRestart': 'Saved, takes effect after restart',
  'status.configured': 'On',
  'status.missingDeps': 'Missing components',
  'status.failed': 'Failed',
  'status.unknown': 'Loading…',
  missingPackages: 'Needs installing: ',
  installNow: 'Install',
  installing: 'Installing…',
  installFailed: 'Install failed: ',
  installedRestart: 'Installed. Save the card, then restart.',
  copyInstall: 'Copy command',
  copied: 'Copied',
  restart: 'Saved. New sessions pick it up after a restart.',
  relaunch: 'Relaunch app',
  permAccessibility: 'Accessibility',
  permScreenRecording: 'Screen Recording',
  permGranted: 'Granted',
  permDenied: 'Denied',
  permUnknown: 'Not decided',
  restartDriver: 'Restart driver',
  restartingDriver: 'Restarting…',
  permissionDeniedHint: 'Tick it in System Settings, then press “Restart driver” — a grant only reaches newly started processes.',
  permissionStaleHint: 'Not taking effect? A driver started before the grant needs one restart.',
  permOpenSettings: 'Open Settings',
  invalidEndpoint: 'Attach mode needs a debug endpoint',
  invalidCommand: 'A command is required',
  diagBrowserExecutable: 'Browser path does not exist: ',
  diagMcpCommand: 'Command does not exist: ',
  diagBrowserDuplicate: 'Multiple browser providers: ',
  diagComputerDuplicate: 'Multiple desktop providers: ',
  diagCuaApp: 'Cua Driver is not installed: ',
  diagCuaBin: 'Command not found: ',
  diagCuaToolchain: 'Desktop tool call failed: ',
  diagCuaProbe: 'Driver status check failed: ',
  takeoverTitle: 'Replace existing configuration',
  takeoverDescription: 'The profile already has handwritten Browser / Desktop entries. Saving replaces them with the selection here.',
  takeoverAck: 'I understand existing entries will be replaced',
  nativeTitle: 'Enable Cua Native',
  nativeDescription: 'Native runs in-process. TCC attaches to DSH-Desktop; a crash can take the host down.',
  nativeAck: 'I understand the Native permission and crash risk',
  confirm: 'Continue',
  cancel: 'Cancel',
}
