export type WeChatKey =
  | 'brand'
  | 'tab.chats'
  | 'tab.contacts'
  | 'tab.discover'
  | 'tab.me'
  | 'search'
  | 'newChat'
  | 'emptyChats'
  | 'emptyChat'
  | 'emptyContacts'
  | 'composer'
  | 'send'
  | 'stop'
  | 'typing'
  | 'preview.typing'
  | 'preview.needYou'
  | 'preview.done'
  | 'preview.image'
  | 'back'
  | 'allow'
  | 'reject'
  | 'approvalTitle'
  | 'questionTitle'
  | 'questionSubmit'
  | 'questionCancel'
  | 'planApprove'
  | 'planDecline'
  | 'me.switch'
  | 'me.switchHint'
  | 'me.about'
  | 'me.aboutBody'
  | 'me.model'
  | 'me.modelHint'
  | 'me.modelEmpty'
  | 'me.modelLoading'
  | 'me.modelNeedChat'
  | 'me.modelFailed'
  | 'fab'
  | 'contactsHint'
  | 'discoverTitle'
  | 'discoverBody'
  | 'discover.scan'
  | 'discover.camera'
  | 'discover.empty'
  | 'discover.open'
  | 'discover.live'
  | 'discover.coverName'
  | 'pickFolder'
  | 'noWorkspace'
  | 'yesterday'
  | 'justNow'

export const zh: Record<WeChatKey, string> = {
  brand: '微信',
  'tab.chats': '微信',
  'tab.contacts': '通讯录',
  'tab.discover': '发现',
  'tab.me': '我',
  search: '搜索',
  newChat: '发起聊天',
  emptyChats: '还没有对话。点右上角加号，像发微信一样跟我说话。',
  emptyChat: '打个招呼，把需求发给我。我会像朋友一样边做边回你。',
  emptyContacts: '工作区会显示在这里。点一个就开始新聊天。',
  composer: '发送消息',
  send: '发送',
  stop: '停止',
  typing: '对方正在输入',
  'preview.typing': '对方正在输入…',
  'preview.needYou': '[有事找你]',
  'preview.done': '[已完成]',
  'preview.image': '[图片]',
  back: '返回',
  allow: '允许',
  reject: '拒绝',
  approvalTitle: '需要你点头',
  questionTitle: '想先问你一下',
  questionSubmit: '回复',
  questionCancel: '先算了',
  planApprove: '按这个来',
  planDecline: '再想想',
  'me.switch': '切换回经典界面',
  'me.switchHint': '随时点右下角绿点回到微信聊天。',
  'me.about': '关于微信风格',
  'me.aboutBody': '这是 DeepSeek Harness 的微信皮肤。左侧是会话，右侧是聊天。对面的人会边干活边用短消息汇报进度。',
  'me.model': '模型',
  'me.modelHint': '点一下就换。当前聊天立刻生效，新开的聊天也用这个。',
  'me.modelEmpty': '这边还没有可用模型。',
  'me.modelLoading': '正在拉模型列表…',
  'me.modelNeedChat': '先开一场聊天，才能切模型。',
  'me.modelFailed': '这次没换成',
  fab: '回到微信',
  contactsHint: '每个工作区是一位联系人。点开就会开一场新聊天。',
  discoverTitle: '朋友圈',
  discoverBody: '各场聊天的进度会发到这里，像朋友圈一样刷。',
  'discover.scan': '扫一扫',
  'discover.camera': '发条动态',
  'discover.empty': '还没有动态。去聊天里丢个需求，做完会出现在这里。',
  'discover.open': '进入聊天',
  'discover.live': '正在忙',
  'discover.coverName': 'DeepSeek',
  pickFolder: '选择文件夹',
  noWorkspace: '先选一个工作区，我们才能开始聊天。',
  yesterday: '昨天',
  justNow: '刚刚',
}

export const en: Record<WeChatKey, string> = {
  brand: 'WeChat',
  'tab.chats': 'Chats',
  'tab.contacts': 'Contacts',
  'tab.discover': 'Discover',
  'tab.me': 'Me',
  search: 'Search',
  newChat: 'New chat',
  emptyChats: 'No chats yet. Tap + and talk to me like a friend.',
  emptyChat: 'Say hi and send the request. I will text progress as I work.',
  emptyContacts: 'Workspaces show up here. Tap one to start a chat.',
  composer: 'Message',
  send: 'Send',
  stop: 'Stop',
  typing: 'Typing',
  'preview.typing': 'Typing…',
  'preview.needYou': '[Needs you]',
  'preview.done': '[Done]',
  'preview.image': '[Photo]',
  back: 'Back',
  allow: 'Allow',
  reject: 'Decline',
  approvalTitle: 'Needs your OK',
  questionTitle: 'Quick question',
  questionSubmit: 'Reply',
  questionCancel: 'Not now',
  planApprove: 'Go with this',
  planDecline: 'Not yet',
  'me.switch': 'Switch to classic UI',
  'me.switchHint': 'The green bubble at the corner brings you back.',
  'me.about': 'About this skin',
  'me.aboutBody': 'A WeChat skin for DeepSeek Harness. Sessions are chats. The other side texts short updates while they work.',
  'me.model': 'Model',
  'me.modelHint': 'Tap to switch. Applies to this chat now, and to new chats.',
  'me.modelEmpty': 'No models available yet.',
  'me.modelLoading': 'Loading models…',
  'me.modelNeedChat': 'Start a chat first, then you can switch models.',
  'me.modelFailed': 'Could not switch',
  fab: 'Open WeChat',
  contactsHint: 'Each workspace is a contact. Tap to start a new chat.',
  discoverTitle: 'Moments',
  discoverBody: 'Work from every chat shows up here, like Moments.',
  'discover.scan': 'Scan',
  'discover.camera': 'New moment',
  'discover.empty': 'No moments yet. Send a request in chat and it will land here.',
  'discover.open': 'Open chat',
  'discover.live': 'Working',
  'discover.coverName': 'DeepSeek',
  pickFolder: 'Choose folder',
  noWorkspace: 'Pick a workspace first, then we can chat.',
  yesterday: 'Yesterday',
  justNow: 'Just now',
}
