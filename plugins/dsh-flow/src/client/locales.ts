export const zh = {
  'command.label': '流程',
  'command.description': '进入 Flow 模式，由主 Agent 规划、子 Agent 执行',
  'command.hint': 'off 退出，或输入任务内容',
  'command.attachmentsUnsupported': '带参数的 /flow 指令不支持附件，请先开启 Flow 模式再发送附件。',
  'command.failed': 'Flow 指令执行失败',
  'chip.on.aria': 'Flow 模式已开启，按下关闭',
  'chip.on.title': 'Flow 模式已开启 — 点击关闭（/flow off）',
  'chip.pending.title': 'Flow 模式将在下一步生效 — 点击取消',
  'chip.failed': 'Flow 模式切换失败',
  'card.action.skip': '跳过',
  'card.action.stop': '停止',
  'card.action.pause': '暂停',
  'card.action.resume': '继续',
  'card.actions.label': '节点操作',
}

export type FlowKey = keyof typeof zh

export const en: Record<FlowKey, string> = {
  'command.label': 'Flow',
  'command.description': 'Enter Flow mode: the Leader plans and child agents execute',
  'command.hint': 'off to leave, or enter a task',
  'command.attachmentsUnsupported': '/flow with arguments does not accept attachments. Enable Flow mode before sending attachments.',
  'command.failed': 'Flow command failed',
  'chip.on.aria': 'Flow mode on, press to turn off',
  'chip.on.title': 'Flow mode on — click to turn off (/flow off)',
  'chip.pending.title': 'Flow mode applies from the next step — click to cancel',
  'chip.failed': 'Failed to change Flow mode',
  'card.action.skip': 'Skip',
  'card.action.stop': 'Stop',
  'card.action.pause': 'Pause',
  'card.action.resume': 'Resume',
  'card.actions.label': 'Node actions',
}
