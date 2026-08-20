// XP progress helpers (mirrors src/shared/pet-state.ts — keep in sync).
import { ASSETS_PATH } from './routes.mjs'

export const HUD_ASSETS = `${ASSETS_PATH}/hud`
export const MAX_LEVEL = 20
const XP_CAP = 1e12
const XP_SAFE_MAX = 1e15

/**
 * Cumulative XP to reach `level`. Cost n→n+1 = 20·n·(n+1); hard-capped at MAX_LEVEL.
 * Keep in sync with src/shared/pet-state.ts.
 */
export function xpForLevel(level) {
  const L = Math.max(1, Math.floor(level))
  if (L <= 1) return 0
  return (20 * L * (L * L - 1)) / 3
}

export function levelFor(xp) {
  const xpSafe = Math.max(0, Math.min(xp, XP_SAFE_MAX))
  let level = 1
  while (level < MAX_LEVEL && xpSafe >= xpForLevel(level + 1)) level += 1
  return level
}

export function xpProgress(xp) {
  const xpSafe = Math.max(0, Math.min(Math.floor(xp), XP_CAP))
  const level = levelFor(xpSafe)
  if (level >= MAX_LEVEL) {
    return { level: MAX_LEVEL, into: 0, need: 0, ratio: 1, maxed: true }
  }
  const floor = xpForLevel(level)
  const ceil = xpForLevel(level + 1)
  const need = Math.max(1, ceil - floor)
  const into = Math.max(0, Math.min(xpSafe - floor, need))
  return { level, into, need, ratio: into / need, maxed: false }
}

/** Temperature-scale fill: cool → warm → hot as ratio rises. */
export function xpFillAsset(ratio) {
  const r = Math.max(0, Math.min(1, ratio))
  if (r < 0.2) return 'game_hud_bar_mp.png'
  if (r < 0.4) return 'game_hud_bar_hp.png'
  if (r < 0.6) return 'game_hud_bar_exp.png'
  if (r < 0.8) return 'game_hud_bar_hp_oran.png'
  return 'game_hud_bar_hp_red.png'
}

export function hudUrl(name) {
  return `${HUD_ASSETS}/${name}`
}

/** Keep in sync with TITLES in src/shared/pet-state.ts (UI-facing fields only). */
export const TITLES = Object.freeze([
  {
    id: 'first-task',
    name: '初次协作',
    description: '完成第 1 个后台任务',
    icon: 'guidequest_group_01.png',
  },
  {
    id: 'helper',
    name: '勤劳伙伴',
    description: '累计完成 20 个任务',
    icon: 'guidequest_group_02.png',
  },
  {
    id: 'veteran',
    name: '百炼成钢',
    description: '累计完成 100 个任务',
    icon: 'guidequest_group_03.png',
  },
  {
    id: 'regular',
    name: '常驻伙伴',
    description: '陪伴时长累计 6 小时',
    icon: 'guidequest_group_04.png',
  },
  {
    id: 'resilient',
    name: '越挫越勇',
    description: '经历 5 次任务失败仍继续',
    icon: 'guidequest_group_05.png',
  },
  {
    id: 'social',
    name: '广结善缘',
    description: '开启过 10 个会话',
    icon: 'guidequest_group_06.png',
  },
  {
    id: 'maxed',
    name: '满级伙伴',
    description: `升到满级 Lv.${MAX_LEVEL}`,
    icon: 'guidequest_group_07.png',
  },
])

const TITLE_BY_ID = new Map(TITLES.map((t) => [t.id, t]))

export function titleDef(id) {
  return TITLE_BY_ID.get(id)
}

export function titleName(id) {
  return titleDef(id)?.name ?? id
}

export function titleDescription(id) {
  return titleDef(id)?.description ?? ''
}

export function titleIcon(id) {
  return titleDef(id)?.icon ?? 'guidequest_group_01.png'
}
