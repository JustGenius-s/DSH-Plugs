import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { CONTRIBUTOR, NAMESPACE, OVERLAY_ID, type WhaleGirlConfig } from '../shared/config.ts'
import { OVERLAY_PATH } from '../shared/routes.ts'
import { bridge } from './bridge.ts'
import { PetCard } from './card.tsx'
import { apply as mountInPage } from './pet.mjs'

export const name = 'dsh-whale-girl'
export const inject = ['slots', 'locale', 'settingsScope'] as const

const NS = 'whale-girl'

const zh = {
  'card.title': '桌面宠物',
  'card.description': '在 DSH-Desktop 里常驻操作系统桌面；浏览器里显示页面内宠物。',
  'card.expand': '展开',
  'card.collapse': '折叠',
  'card.unsaved': '未保存',
  'card.readOnly': '当前设置文档为只读，无法保存修改。',
  'card.save': '保存',
  'card.saving': '保存中…',
  'card.discard': '放弃',
  'card.saveFailed': '保存失败，请重试。',
  'gate.enabled': '显示宠物',
  'gate.enabledHint': '关闭后隐藏桌宠（含桌面 overlay 与页面内宠物）。',
  'gate.walk': '随机游走',
  'gate.walkHint': '空闲时偶尔在屏幕上走动。',
  'field.size': '尺寸',
  'field.sizeHint': '角色画布边长，64–160 像素。',
  'field.opacity': '透明度',
  'field.opacityHint': '0.2 半透明，1 完全不透明。',
  'field.sleep': '打盹（秒）',
  'field.sleepHint': '空闲多久后进入睡眠动画。',
}

const en: Record<keyof typeof zh, string> = {
  'card.title': 'Desktop pet',
  'card.description': 'Sits on the OS desktop in DSH-Desktop; in-page companion in a plain browser.',
  'card.expand': 'Expand',
  'card.collapse': 'Collapse',
  'card.unsaved': 'Unsaved',
  'card.readOnly': 'The settings document is read-only; changes cannot be saved.',
  'card.save': 'Save',
  'card.saving': 'Saving…',
  'card.discard': 'Discard',
  'card.saveFailed': 'Save failed, please retry.',
  'gate.enabled': 'Show pet',
  'gate.enabledHint': 'Hide the pet, including the desktop overlay and the in-page companion.',
  'gate.walk': 'Wander',
  'gate.walkHint': 'Occasionally walk around the screen while idle.',
  'field.size': 'Size',
  'field.sizeHint': 'Sprite canvas edge length, 64–160 pixels.',
  'field.opacity': 'Opacity',
  'field.opacityHint': '0.2 translucent, 1 fully opaque.',
  'field.sleep': 'Nap after (seconds)',
  'field.sleepHint': 'Idle time before the sleep animation.',
}

function mountOverlay(): () => void {
  const overlays = bridge()?.overlays
  if (overlays === undefined) return () => {}
  let alive = true
  let fallbackDispose: (() => void) | undefined
  const off = overlays.onClosed((event) => {
    if (!alive || event.contributor !== CONTRIBUTOR) return
  })
  void overlays.open({
    contributor: CONTRIBUTOR,
    id: OVERLAY_ID,
    url: OVERLAY_PATH,
    bounds: { width: 160, height: 180 },
    chrome: {
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      ignoreMouseEvents: 'none',
    },
  }).catch((err) => {
    console.warn('[whale-girl] overlay open failed; falling back in-page', err)
    if (alive) fallbackDispose = mountInPage()
  })
  return () => {
    alive = false
    off()
    fallbackDispose?.()
    void overlays.close(OVERLAY_ID)
  }
}

function mountPet(): () => void {
  if (bridge()?.overlays !== undefined) return mountOverlay()
  return mountInPage()
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, 'zh', zh), 'dsh-whale-girl: zh dictionary')
  ctx.effect(() => ctx.locale.register(NS, 'en', en), 'dsh-whale-girl: en dictionary')

  const scope = ctx.settingsScope.bind<WhaleGirlConfig>({ namespace: NAMESPACE })
  ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register(
      {
        name: 'settings.plugin.item',
        key: NAMESPACE,
        locale: NS as never,
        inject: () => ({ scope }),
      },
      PetCard as never,
    ),
  )

  ctx.effect(() => {
    const enabledOf = (): boolean => {
      const snap = scope.getSnapshot()
      return snap.status === 'unavailable' ? true : (snap.value?.enabled ?? true)
    }
    let enabled = enabledOf()
    let disposePet = enabled ? mountPet() : () => {}
    const off = scope.subscribe(() => {
      const next = enabledOf()
      if (next === enabled) return
      enabled = next
      disposePet()
      disposePet = enabled ? mountPet() : () => {}
    })
    return () => {
      off()
      disposePet()
    }
  }, 'dsh-whale-girl: pet')
}
