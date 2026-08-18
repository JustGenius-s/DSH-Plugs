/** This monorepo — a second catalog source beside awesome-dsh-plugin. */
export const DSH_PLUGS_REPO = 'Rory-X/DSH-Plugs'
export const DSH_PLUGS_URL = 'https://github.com/Rory-X/DSH-Plugs'
export const DSH_PLUGS_SOURCE = 'dsh-plugs'
export const AWESOME_SOURCE = 'awesome'

export interface ProfilePatch {
  id: string
  disabled?: boolean
}

export interface DshPlugsPluginDef {
  folder: string
  packageName: string
  category: string
  description: { en: string; zh: string }
  profilePatches?: ProfilePatch[]
}

export const DSH_PLUGS_PLUGINS: readonly DshPlugsPluginDef[] = [
  {
    folder: 'dsh-codex',
    packageName: '@just-genius/dsh-codex',
    category: 'ui',
    description: {
      en: 'Codex-style navigation, side-panel host, and Warp-style terminal in one plugin.',
      zh: 'Codex 风格导航、侧边栏宿主与 Warp 风格终端的整合插件。',
    },
  },
  {
    folder: 'session-navigator',
    packageName: '@just-genius/dsh-session-navigator',
    category: 'session',
    description: {
      en: 'Codex-style tick rail on the conversation: one tick per user message, hover preview, and click-to-jump.',
      zh: '对话左侧的 Codex 风格刻度条：每条用户消息一个刻度，悬停预览，点击跳转。',
    },
  },
  {
    folder: 'dsh-model-custom-ex',
    packageName: '@just-genius/dsh-model-custom-ex',
    category: 'ui',
    description: {
      en: 'Replaces the official Models page with per-model vision and reasoning-effort selectors. Disables the stock Models tab.',
      zh: '替换官方「模型」页，为自定义模型增加视觉与思考强度选择。会停用官方模型 tab。',
    },
    profilePatches: [{ id: 'ui-settings-models', disabled: true }],
  },
  {
    folder: 'dsh-plugin-marketplace',
    packageName: '@just-genius/dsh-plugin-marketplace',
    category: 'ui',
    description: {
      en: 'Settings → Plugins marketplace tab. Browses this repo plus the awesome-dsh-plugin catalog.',
      zh: '设置 → 插件中的市场页。浏览本仓库与 awesome-dsh-plugin 目录。',
    },
  },
  {
    folder: 'dsh-plugin-config',
    packageName: '@just-genius/dsh-plugin-config',
    category: 'ui',
    description: {
      en: 'Replaces the official Plugin list: group by origin and mount plane, then disable or uninstall mounted plugins.',
      zh: '替换官方插件列表：按来源和挂载类型分组，并提供停用 / 卸载入口。',
    },
  },
  {
    folder: 'dsh-wechat-chat',
    packageName: '@just-genius/dsh-wechat-chat',
    category: 'ui',
    description: {
      en: 'WeChat-style chat skin: sessions become chats, the agent texts short progress bubbles, and you can switch back from Me.',
      zh: '微信风格聊天皮肤：会话变成聊天，对面像真人一样用短气泡汇报进度，可从「我」切回经典界面。',
    },
  },
]

export function githubPathSpec(folder: string): string {
  return `github:${DSH_PLUGS_REPO}#path:plugins/${folder}`
}

export function pluginUrl(folder: string): string {
  return `${DSH_PLUGS_URL}/tree/main/plugins/${folder}`
}
