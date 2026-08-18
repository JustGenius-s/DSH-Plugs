// Card stylesheet, injected as a single <style data-plugin> tag following
// the same contract DSH client bundles use (idempotent; HMR removes tags by
// the data-plugin attribute). Rules mirror the official plugin card chrome
// (ui-settings-plugins' PluginCard.module.css / fields.module.css) token for
// token, so this card reads as a native one; class names carry our own prefix
// because the official CSS-module classes are build-time hashes.

const CSS = `
.dsh-du-card{list-style:none;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);transition:border-color .16s,background .16s}
.dsh-du-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.dsh-du-card-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.dsh-du-header{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px}
.dsh-du-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dsh-du-headtext{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.dsh-du-name{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
.dsh-du-description{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-du-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}
.dsh-du-chevron-open{transform:rotate(180deg)}
.dsh-du-pending{flex:none;border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.dsh-du-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
.dsh-du-readonly{margin:12px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-du-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}
.dsh-du-field + .dsh-du-field{border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-du-field-head{display:flex;align-items:center;gap:8px}
.dsh-du-label{flex:1;min-width:0;font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dsh-du-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
/* Switch: checkbox restyled as a toggle; the knob slides with :checked. */
.dsh-du-switch{appearance:none;margin:0;flex:none;width:32px;height:18px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);position:relative;cursor:pointer;transition:background .16s,border-color .16s}
.dsh-du-switch::after{content:'';position:absolute;top:1px;left:1px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-tertiary);transition:transform .16s,background .16s}
.dsh-du-switch:checked{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.dsh-du-switch:checked::after{transform:translateX(14px);background:var(--dsw-alias-bg-layer-3,#fff)}
.dsh-du-switch:hover:not(:disabled):not(:checked){border-color:var(--dsw-alias-label-dimmed)}
.dsh-du-switch:disabled{opacity:.4;cursor:default}
.dsh-du-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-du-versions{display:flex;align-items:center;gap:8px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.dsh-du-versions > span{flex:1;min-width:0}
.dsh-du-check{flex:none;appearance:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:none;color:var(--dsw-alias-label-secondary);padding:3px 12px;font:inherit;font-size:12px;line-height:1.5;cursor:pointer}
.dsh-du-check:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.dsh-du-check:disabled{opacity:.4;cursor:default}
.dsh-du-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 0 4px;border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-du-failed{flex:1;min-width:0;margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-error)}
.dsh-du-discard,.dsh-du-save{appearance:none;border:1px solid transparent;border-radius:8px;padding:5px 14px;font:inherit;font-size:13px;line-height:1.5;cursor:pointer}
.dsh-du-discard{border-color:var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-secondary)}
.dsh-du-discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.dsh-du-save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.dsh-du-discard:disabled,.dsh-du-save:disabled{opacity:.4;cursor:default}
.dsh-du-discard:focus-visible,.dsh-du-save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
`

/** Inject the stylesheet once; safe to call on every materialization. */
export function ensureCardStyles(): void {
  if (typeof document === 'undefined') return
  const tagId = '@just-genius/dsh-desktop-update/card.css'
  if (document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = '@just-genius/dsh-desktop-update'
  tag.dataset.pluginCss = tagId
  tag.textContent = CSS
  document.head.appendChild(tag)
}
