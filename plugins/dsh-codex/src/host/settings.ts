import { Schema } from '@just-genius/dsh-plugin-runtime/host'
import { FONT_PREFERENCE_MAX_LENGTH } from '../shared/fonts'
import {
  DEFAULT_CONFIG,
  FULL_SESSION_LOAD_LIMIT_MAX,
  FULL_SESSION_LOAD_LIMIT_MIN,
  type DshCodexConfig,
} from '../shared/config'

/** Host-side schema for the one durable Codex configuration namespace. */
export const ConfigSchema: Schema<Partial<DshCodexConfig>, DshCodexConfig> = Schema.object({
  uiFontFamily: Schema.string().max(FONT_PREFERENCE_MAX_LENGTH).default(DEFAULT_CONFIG.uiFontFamily),
  codeFontFamily: Schema.string().max(FONT_PREFERENCE_MAX_LENGTH).default(DEFAULT_CONFIG.codeFontFamily),
  longMessageCollapseEnabled: Schema.boolean().default(DEFAULT_CONFIG.longMessageCollapseEnabled),
  stickyUserBubbleEnabled: Schema.boolean().default(DEFAULT_CONFIG.stickyUserBubbleEnabled),
  stickyUserBubbleMode: Schema.union([
    Schema.const('running'),
    Schema.const('always'),
  ]).default(DEFAULT_CONFIG.stickyUserBubbleMode),
  fullSessionLoadEnabled: Schema.boolean().default(DEFAULT_CONFIG.fullSessionLoadEnabled),
  fullSessionLoadLimit: Schema.number().min(FULL_SESSION_LOAD_LIMIT_MIN).max(FULL_SESSION_LOAD_LIMIT_MAX).default(DEFAULT_CONFIG.fullSessionLoadLimit),
  terminalEnabled: Schema.boolean().default(DEFAULT_CONFIG.terminalEnabled),
  gitGraphEnabled: Schema.boolean().default(DEFAULT_CONFIG.gitGraphEnabled),
  customFilesEnabled: Schema.boolean().default(DEFAULT_CONFIG.customFilesEnabled),
  sideChatEnabled: Schema.boolean().default(DEFAULT_CONFIG.sideChatEnabled),
  sideChatContextEnabled: Schema.boolean().default(DEFAULT_CONFIG.sideChatContextEnabled),
  highlightThemeLight: Schema.string().default(DEFAULT_CONFIG.highlightThemeLight),
  highlightThemeDark: Schema.string().default(DEFAULT_CONFIG.highlightThemeDark),
  terminalShell: Schema.union([
    Schema.const('auto'),
    Schema.const('bash'),
    Schema.const('zsh'),
  ]).default(DEFAULT_CONFIG.terminalShell),
  terminalScrollback: Schema.number().min(500).max(20_000).default(DEFAULT_CONFIG.terminalScrollback),
  terminalFontSize: Schema.number().min(10).max(24).default(DEFAULT_CONFIG.terminalFontSize),
  quickActions: Schema.array(Schema.object({
    id: Schema.string(),
    name: Schema.string(),
    steps: Schema.array(Schema.object({
      command: Schema.string(),
      target: Schema.union([Schema.const('current'), Schema.const('new')]),
    })),
  })).default([]),
})


/** DSH 0.1.7 discovers settings through the loader's Config export. */
export const Config = ConfigSchema.default(DEFAULT_CONFIG).volatile()

export type CodexConfigInput = Partial<DshCodexConfig> | ReturnType<typeof Config>

export function createCodexConfigSource(config?: CodexConfigInput): () => DshCodexConfig {
  return () => {
    const value = config && 'get' in config ? config.get() : config
    return {
      ...DEFAULT_CONFIG,
      ...value,
      quickActions: (value?.quickActions ?? []).map(action => ({
        ...action,
        steps: action.steps.map(step => ({ ...step })),
      })),
    }
  }
}
