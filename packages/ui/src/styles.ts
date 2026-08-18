// Shared stylesheet for the DSH-native primitives in this package. Injected
// once as a single <style> tag, following the same contract DSH client
// bundles use (idempotent; HMR removes tags by the data-plugin attribute).
// Rules mirror the official DSH components token for token
// (ui-settings-plugins' PluginCard/fields, ui-settings-models' addButton,
// ui-settings-plugin-inventory's configTag); class names carry our own
// prefix because the official CSS-module classes are build-time hashes.

const CSS = `
/* Switch: checkbox restyled as a toggle; the knob slides with :checked.
 * Mirrors the official fields switch. */
.dsh-ui-switch{appearance:none;margin:0;flex:none;width:32px;height:18px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);position:relative;cursor:pointer;transition:background .16s,border-color .16s}
.dsh-ui-switch::after{content:'';position:absolute;top:1px;left:1px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-tertiary);transition:transform .16s,background .16s}
.dsh-ui-switch:checked{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.dsh-ui-switch:checked::after{transform:translateX(14px);background:var(--dsw-alias-bg-layer-3,#fff)}
.dsh-ui-switch:hover:not(:disabled):not(:checked){border-color:var(--dsw-alias-label-dimmed)}
.dsh-ui-switch:disabled{opacity:.4;cursor:default}
.dsh-ui-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}

/* Field head row: label left, reset action right (fields.tsx .head). */
.dsh-ui-field-head{display:flex;align-items:center;gap:8px}
.dsh-ui-label{flex:1;min-width:0;font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}

/* Text-only reset button sitting at the field head's right edge
 * (fields.module.css .reset). */
.dsh-ui-reset{border:none;background:none;padding:0;font:inherit;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsh-ui-reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.dsh-ui-reset:disabled{cursor:default}

/* Bordered rectangular secondary action, e.g. "test connection"
 * (PluginCard.module.css .discard). */
.dsh-ui-action{appearance:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 14px;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:1.5;cursor:pointer}
.dsh-ui-action:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.dsh-ui-action:disabled{opacity:.4;cursor:default}
.dsh-ui-action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}

/* Dashed full-row "add" slot closing a list (ModelsSection .addButton).
 * Dashed on purpose: it reads as a place to fill, not a command. */
.dsh-ui-add{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;width:100%;height:44px;border:1px dashed var(--dsw-alias-border-l3);border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;cursor:pointer}
.dsh-ui-add:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-ui-add:disabled{opacity:.4;cursor:default}
.dsh-ui-add:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}

/* Status tag, e.g. "installed" / "enabled"
 * (ui-settings-plugin-inventory .configTag). */
.dsh-ui-tag{display:inline-flex;align-items:center;min-height:20px;border-radius:5px;padding:1px 6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;white-space:nowrap}
.dsh-ui-tag[data-on='true']{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);color:var(--dsw-alias-state-success-primary)}

/* Card footer with right-aligned discard/save buttons
 * (PluginCard.module.css .footer/.discard/.save). */
.dsh-ui-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 0 4px;border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-ui-discard,.dsh-ui-save{appearance:none;border:1px solid transparent;border-radius:8px;padding:5px 14px;font:inherit;font-size:13px;line-height:1.5;cursor:pointer}
.dsh-ui-discard{border-color:var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-secondary)}
.dsh-ui-discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.dsh-ui-save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.dsh-ui-discard:disabled,.dsh-ui-save:disabled{opacity:.4;cursor:default}
.dsh-ui-discard:focus-visible,.dsh-ui-save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
`

let injected = false

/** Inject the stylesheet once; safe to call on every render. */
export function ensureStyles(): void {
  if (injected || typeof document === 'undefined') return
  if (document.head.querySelector('style[data-dsh-ui]') !== null) {
    injected = true
    return
  }
  const tag = document.createElement('style')
  tag.setAttribute('data-dsh-ui', '')
  tag.textContent = CSS
  document.head.appendChild(tag)
  injected = true
}
