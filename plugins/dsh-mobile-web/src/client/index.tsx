// Browser half of @just-genius/dsh-mobile-web.
//
// Adapts the official three-column AppFrame for phones without replacing
// layout or conversation: CSS turns the sidebar / details columns into
// drawers, and a `shell.overlay` chrome supplies the hamburger + backdrop.

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { startAdapt } from './adapt.ts'
import { MobileChrome, type MobileChromeInjected } from './chrome.tsx'
import { en, zh, type MobileKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'mobile.web': MobileKey
  }
}

const NS = 'mobile.web'

export const inject = ['slots', 'layout', 'locale', 'sessions'] as const

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-mobile-web: dictionaries')
  ctx.effect(() => startAdapt(ctx), 'dsh-mobile-web: document adapt')

  const t = ctx.locale.bind(NS)
  const injected = (): MobileChromeInjected => ({
    toggleSidebar: () => ctx.layout.toggleSidebar(),
    t,
  })

  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      {
        name: 'shell.overlay',
        id: 'mobile-web-chrome',
        order: 0,
        locale: NS,
        inject: injected,
      },
      MobileChrome as never,
    ),
  )
}
