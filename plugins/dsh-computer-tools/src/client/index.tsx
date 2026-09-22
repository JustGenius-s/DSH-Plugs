import type { ClientContext } from '@just-genius/dsh-plugin-runtime/client'
import { CLIENT_SERVICES } from '@just-genius/dsh-plugin-runtime/client'
import { ComputerToolsSection } from './ComputerToolsSection.tsx'
import type { ComputerToolsSectionInjected } from './ComputerToolsSection.tsx'
import { installComputerToolsSettingsIcon } from './computer-tools-settings-icon.ts'
import { en, zh, type ComputerToolsKey } from './locales.ts'
import { ComputerToolsController } from './store.ts'

declare module '@just-genius/dsh-plugin-runtime/client' {
  interface PluginLocaleNamespaceMap {
    'computer-tools': ComputerToolsKey
  }
}

const NS = 'computer-tools'

export const inject = [CLIENT_SERVICES.slots, CLIENT_SERVICES.locale] as const

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-computer-tools: dictionaries')

  const t = ctx.locale.bind(NS) as ComputerToolsSectionInjected['t']
  const controller = new ComputerToolsController()
  ctx.effect(() => () => controller.dispose(), 'dsh-computer-tools: controller')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'computer-tools',
    order: 48,
    label: () => t('nav'),
    inject: () => ({ t, controller }),
  }, ComputerToolsSection))
  ctx.effect(() => installComputerToolsSettingsIcon(() => t('nav')), 'dsh-computer-tools: settings icon')
}
