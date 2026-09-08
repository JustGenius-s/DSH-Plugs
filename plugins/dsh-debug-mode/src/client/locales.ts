export type DebugKey =
  | 'chip.on.aria'
  | 'chip.on.title'
  | 'chip.failed'
  | 'logs.title'
  | 'logs.empty'
  | 'logs.clear'
  | 'logs.clear.aria'
  | 'logs.clear.failed'
  | 'repro.title'
  | 'repro.proceed'
  | 'repro.fixed'
  | 'source.agent'
  | 'source.user'
  | 'source.ingest'

export const zh: Record<DebugKey, string> = {
  'chip.on.aria': 'debug mode 已开启，按下关闭',
  'chip.on.title': 'debug mode 已开启 — 点击关闭（/debug off）',
  'chip.failed': '退出 debug mode 失败',
  'logs.title': 'Debug Logs',
  'logs.empty': 'Waiting for log entries…',
  'logs.clear': '清空',
  'logs.clear.aria': '清空 Debug Logs',
  'logs.clear.failed': '清空日志失败',
  'repro.title': 'Reproduction Steps',
  'repro.proceed': 'Proceed',
  'repro.fixed': 'Mark as fixed',
  'source.agent': 'agent',
  'source.user': 'you',
  'source.ingest': 'runtime',
}

export const en: Record<DebugKey, string> = {
  'chip.on.aria': 'Debug mode on, press to turn off',
  'chip.on.title': 'Debug mode on — click to turn off (/debug off)',
  'chip.failed': 'failed to exit debug mode',
  'logs.title': 'Debug Logs',
  'logs.empty': 'Waiting for log entries…',
  'logs.clear': 'Clear',
  'logs.clear.aria': 'Clear Debug Logs',
  'logs.clear.failed': 'failed to clear logs',
  'repro.title': 'Reproduction Steps',
  'repro.proceed': 'Proceed',
  'repro.fixed': 'Mark as fixed',
  'source.agent': 'agent',
  'source.user': 'you',
  'source.ingest': 'runtime',
}
