/** Global mobile overrides. Selectors prefer stable data-* hooks over CSS-module hashes. */
export const MOBILE_CSS = `
html.dsh-mobile-web {
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}

[data-dsh-mobile-chrome] {
  display: none;
}

@media (max-width: 768px), ((pointer: coarse) and (max-width: 1024px)) {
  html.dsh-mobile-web,
  html.dsh-mobile-web body,
  html.dsh-mobile-web #root {
    height: 100%;
    max-height: 100dvh;
    overflow: hidden;
  }

  html.dsh-mobile-web {
    --dsh-mobile-drawer-width: min(86vw, 320px);
    --dsh-mobile-menu-size: 44px;
  }

  html.dsh-mobile-web [data-dsh-mobile-chrome] {
    display: contents;
  }

  html.dsh-mobile-web :is([data-dsh-mobile-frame], :has(> [data-shell-overlay])) {
    grid-template-columns: 0 minmax(0, 1fr) 0 !important;
    width: 100%;
    height: var(--dsh-vv-height, 100dvh) !important;
    max-height: var(--dsh-vv-height, 100dvh);
    margin-top: var(--dsh-vv-top, 0px);
    overflow: hidden;
  }

  html.dsh-mobile-web :is([data-dsh-mobile-frame], :has(> [data-shell-overlay])) > :first-child {
    position: fixed;
    z-index: 40;
    top: var(--dsh-vv-top, 0px);
    left: 0;
    bottom: auto;
    width: var(--dsh-mobile-drawer-width) !important;
    height: var(--dsh-vv-height, 100dvh);
    max-height: var(--dsh-vv-height, 100dvh);
    transform: translateX(-105%);
    transition: transform 0.22s var(--ds-ease-in-out, ease);
    box-shadow: none;
    padding-top: env(safe-area-inset-top, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    padding-left: env(safe-area-inset-left, 0px);
    overflow: hidden;
  }

  html.dsh-mobile-web :is([data-dsh-mobile-frame], :has(> [data-shell-overlay])):not([data-sidebar-collapsed]) > :first-child {
    transform: translateX(0);
    box-shadow: var(--dsw-shadow-lv2, 0 8px 28px rgb(0 0 0 / 18%));
  }

  html.dsh-mobile-web :is([data-dsh-mobile-frame], :has(> [data-shell-overlay])) > :nth-child(3) {
    position: fixed;
    z-index: 45;
    top: var(--dsh-vv-top, 0px);
    right: 0;
    left: 0;
    width: 100% !important;
    height: var(--dsh-vv-height, 100dvh);
    max-height: var(--dsh-vv-height, 100dvh);
    background: var(--dsw-alias-bg-base);
    transform: translateX(100%);
    transition: transform 0.22s var(--ds-ease-in-out, ease);
    padding-top: env(safe-area-inset-top, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  html.dsh-mobile-web :is([data-dsh-mobile-frame], :has(> [data-shell-overlay])):not([data-details-collapsed]) > :nth-child(3) {
    transform: translateX(0);
  }

  html.dsh-mobile-web :is([data-dsh-mobile-frame], :has(> [data-shell-overlay])) > [data-side] {
    display: none !important;
  }

  html.dsh-mobile-web [data-phase] {
    --dsh-chat-content-width: min(100%, 748px);
    --dsh-composer-side-clearance: 8px;
    --dsh-composer-card-max-width: calc(var(--dsh-chat-content-width) + 16px);
  }

  html.dsh-mobile-web [data-phase] > :first-child {
    padding: 8px 12px 0 calc(var(--dsh-mobile-menu-size) + 12px + env(safe-area-inset-left, 0px)) !important;
  }

  html.dsh-mobile-web [data-phase] [role=tablist] {
    gap: 16px !important;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  html.dsh-mobile-web [data-conversation-scroll] {
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-y: contain;
    padding-left: max(8px, env(safe-area-inset-left, 0px));
    padding-right: max(8px, env(safe-area-inset-right, 0px));
  }

  html.dsh-mobile-web [data-composer-seat] {
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  html.dsh-mobile-web textarea,
  html.dsh-mobile-web input:not([type=checkbox]):not([type=radio]):not([type=range]) {
    font-size: max(16px, 1em);
  }

  html.dsh-mobile-web button,
  html.dsh-mobile-web [role=button] {
    touch-action: manipulation;
  }

  html.dsh-mobile-web pre,
  html.dsh-mobile-web [data-phase] code {
    max-width: 100%;
    overflow-x: auto;
  }

  html.dsh-mobile-web [role=dialog],
  html.dsh-mobile-web [aria-modal=true] {
    max-width: calc(100vw - 16px) !important;
    width: min(100%, calc(100vw - 16px));
    max-height: calc(var(--dsh-vv-height, 100dvh) - 16px) !important;
  }

  html.dsh-mobile-web [data-dsh-session-nav] {
    display: none !important;
  }

  [data-dsh-mobile-menu],
  [data-dsh-mobile-backdrop] {
    pointer-events: auto;
  }

  [data-dsh-mobile-backdrop] {
    display: none;
    position: absolute;
    inset: 0;
    z-index: 1;
    background: color-mix(in srgb, #000 38%, transparent);
  }

  [data-dsh-mobile-frame]:not([data-sidebar-collapsed]) [data-dsh-mobile-backdrop] {
    display: block;
  }

  [data-dsh-mobile-menu] {
    position: absolute;
    z-index: 2;
    top: calc(8px + env(safe-area-inset-top, 0px));
    left: calc(8px + env(safe-area-inset-left, 0px));
    box-sizing: border-box;
    width: var(--dsh-mobile-menu-size);
    height: var(--dsh-mobile-menu-size);
    margin: 0;
    padding: 0;
    border: none;
    border-radius: 50%;
    color: var(--dsw-alias-label-primary);
    background: var(--dsw-alias-bg-base);
    box-shadow: var(--dsw-shadow-lv1, 0 1px 4px rgb(0 0 0 / 12%));
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  [data-dsh-mobile-menu]:hover,
  [data-dsh-mobile-menu]:focus-visible {
    background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-base));
  }

  [data-dsh-mobile-menu]:focus-visible {
    outline: 2px solid var(--dsw-alias-state-business-primary, #3964fe);
    outline-offset: 2px;
  }

  [data-dsh-mobile-frame]:not([data-sidebar-collapsed]) [data-dsh-mobile-menu] {
    display: none;
  }

  @media (prefers-reduced-motion: reduce) {
    html.dsh-mobile-web :is([data-dsh-mobile-frame], :has(> [data-shell-overlay])) > :first-child,
    html.dsh-mobile-web :is([data-dsh-mobile-frame], :has(> [data-shell-overlay])) > :nth-child(3) {
      transition: none;
    }
  }
}
`
