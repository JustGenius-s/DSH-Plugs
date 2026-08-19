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

/* Field column with a divider between siblings, and its head row:
 * label left, action right (fields.tsx .head). */
.dsh-ui-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}
.dsh-ui-field + .dsh-ui-field{border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-ui-field-head{display:flex;align-items:center;gap:8px}
.dsh-ui-label{flex:1;min-width:0;font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dsh-ui-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}

/* Fixed-width number input sitting at a field head's right edge. */
.dsh-ui-number{appearance:textfield;flex:none;width:72px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);padding:3px 8px;font:inherit;font-size:13px;line-height:1.5}
.dsh-ui-number:disabled{opacity:.4}
.dsh-ui-number:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}

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

/* Status tag (ui-settings-plugin-inventory .configTag). The pill variant
 * carries a background; the text variant is plain colored text. */
.dsh-ui-tag{display:inline-flex;align-items:center;min-height:20px;border-radius:5px;padding:1px 6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;white-space:nowrap}
.dsh-ui-tag[data-tone='success']{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);color:var(--dsw-alias-state-success-primary)}
.dsh-ui-tag[data-variant='text']{min-height:0;border-radius:0;padding:0;background:none;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dsh-ui-tag[data-variant='text'][data-tone='strong']{color:var(--dsw-alias-label-secondary)}
.dsh-ui-tag[data-variant='text'][data-tone='business']{color:var(--dsw-alias-state-business-primary)}

/* "Unsaved" pill riding a settings card header. */
.dsh-ui-pending{flex:none;border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}

/* Collapsible settings card (official PluginCard chrome). */
.dsh-ui-card{list-style:none;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);transition:border-color .16s,background .16s}
.dsh-ui-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.dsh-ui-card[data-open='true']{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.dsh-ui-card-header{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px}
.dsh-ui-card-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dsh-ui-card-headtext{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.dsh-ui-card-name{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
.dsh-ui-card-desc{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-ui-card-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}

/* Chevron: pointing down in cards (rotates 180), right in rows (rotates 90). */
.dsh-ui-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}
.dsh-ui-chevron[data-open='true'][data-point='down']{transform:rotate(180deg)}
.dsh-ui-chevron[data-open='true'][data-point='right']{transform:rotate(90deg)}

/* Card footer with right-aligned discard/save buttons
 * (PluginCard.module.css .footer/.discard/.save). */
.dsh-ui-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 0 4px;border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-ui-discard,.dsh-ui-save{appearance:none;border:1px solid transparent;border-radius:8px;padding:5px 14px;font:inherit;font-size:13px;line-height:1.5;cursor:pointer}
.dsh-ui-discard{border-color:var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-secondary)}
.dsh-ui-discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.dsh-ui-save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.dsh-ui-discard:disabled,.dsh-ui-save:disabled{opacity:.4;cursor:default}
.dsh-ui-discard:focus-visible,.dsh-ui-save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}

/* Expandable row card (plugin inventory rows): a head button with chevron,
 * title/summary, a right-edge meta slot, and a divided body. */
.dsh-ui-rows{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.dsh-ui-row{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;min-width:0;overflow:hidden}
.dsh-ui-row[data-open='true']{border-color:var(--dsw-alias-border-l1)}
.dsh-ui-row[data-conflict='true']{border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, var(--dsw-alias-border-l2))}
.dsh-ui-row-head{display:flex;align-items:stretch;min-width:0}
.dsh-ui-row-main{appearance:none;flex:1;min-width:0;display:flex;align-items:flex-start;gap:8px;margin:0;padding:10px 8px 10px 10px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dsh-ui-row-main:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dsh-ui-row-chevron{margin-top:3px}
.dsh-ui-row-titles{min-width:0;display:flex;flex-direction:column;gap:1px}
.dsh-ui-row-name{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;line-height:20px}
.dsh-ui-row-summary{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dsh-ui-row-summary[data-lines='2']{white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.dsh-ui-row-meta{display:flex;align-items:center;align-self:center;gap:8px;flex:none;padding:8px 10px 8px 0}
.dsh-ui-row-body{border-top:1px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:10px;padding:10px 12px 12px}

/* Grouped tree: section head (title + count, optionally a toggle with
 * actions), a left-border indented container, and sub-group names. */
.dsh-ui-tree{display:flex;flex-direction:column;gap:16px}
.dsh-ui-tgroup{display:flex;flex-direction:column;gap:10px;min-width:0}
.dsh-ui-tgroup-head{display:flex;align-items:center;gap:4px;min-width:0}
.dsh-ui-tgroup-static{display:flex;align-items:baseline;gap:7px;padding:0 2px}
.dsh-ui-tgroup-toggle{appearance:none;flex:1;min-width:0;display:flex;align-items:center;gap:8px;margin:0;padding:4px 2px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dsh-ui-tgroup-toggle:hover{background:var(--dsw-alias-bg-layer-3)}
.dsh-ui-tgroup-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:0}
.dsh-ui-tgroup-title{margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;line-height:20px}
.dsh-ui-tgroup-count{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:12px;line-height:18px;flex:none}
.dsh-ui-tgroup-actions{display:flex;align-items:center;gap:0;min-height:28px;flex:none}
.dsh-ui-indent{display:flex;flex-direction:column;gap:10px;margin-left:7px;padding-left:12px;border-left:1px solid var(--dsw-alias-border-l2)}
.dsh-ui-subname{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:600;line-height:18px;padding:0 2px}

/* Filter chip row. */
.dsh-ui-filters{display:flex;flex-wrap:wrap;gap:6px}
.dsh-ui-chip{appearance:none;margin:0;padding:4px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.dsh-ui-chip[data-active='true']{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent)}
.dsh-ui-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}

/* 28x28 ghost icon button with an active (business-colored) state. */
.dsh-ui-icon-button{box-sizing:border-box;appearance:none;margin:0;padding:0;width:28px;height:28px;min-width:28px;min-height:28px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsh-ui-icon-button:hover{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}
.dsh-ui-icon-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:0}
.dsh-ui-icon-button svg{display:block;width:16px;height:16px;flex:none}
.dsh-ui-icon-button[data-active='true']{color:var(--dsw-alias-state-business-primary)}

/* One-line notice under a form or row: info (secondary), ok (business),
 * error (error color, keeps line breaks). */
.dsh-ui-notice{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsh-ui-notice[data-kind='ok']{color:var(--dsw-alias-state-business-primary)}
.dsh-ui-notice[data-kind='error']{color:var(--dsw-alias-state-error-primary);white-space:pre-wrap}

/* Single-line command row: scrollable code with an action (e.g. copy). */
.dsh-ui-command{display:flex;align-items:center;gap:4px;min-width:0;padding:4px 4px 4px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.dsh-ui-command-label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
.dsh-ui-command code{flex:1;min-width:0;overflow-x:auto;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;white-space:nowrap}
`

// Page-level conventions: the column settings tabs render in, the tertiary
// status line, and the load-failure row. Injected together with the
// component sheet above by ensurePageStyles().
const PAGE_CSS = `
/* Settings tab column (official settings tabs: 760px, 14px gaps). */
.dsh-ui-section{width:100%;max-width:760px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:14px}

/* Tertiary status line: loading, empty states, section hints. */
.dsh-ui-status{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}

/* Load-failure row: error-colored text beside a retry action. */
.dsh-ui-failure{display:flex;align-items:center;gap:10px;color:var(--dsw-alias-state-error-primary);font-size:13px;line-height:20px}
.dsh-ui-failure p{margin:0}
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
  tag.textContent = CSS + PAGE_CSS
  document.head.appendChild(tag)
  injected = true
}

/**
 * Inject a plugin's own stylesheet under the DSH client contract: one
 * idempotent <style data-plugin-css> tag per stylesheet, tagged with the
 * owning plugin so the HMR receiver can strip it. An existing tag's content
 * is refreshed in place, so watch-mode rebuilds never leave stale rules.
 */
export function injectStyles(plugin: string, tagId: string, css: string): void {
  if (typeof document === 'undefined') return
  const existing = document.querySelector(
    'style[data-plugin-css=' + JSON.stringify(tagId) + ']',
  )
  if (existing instanceof HTMLStyleElement) {
    if (existing.textContent !== css) existing.textContent = css
    return
  }
  const tag = document.createElement('style')
  tag.dataset.plugin = plugin
  tag.dataset.pluginCss = tagId
  tag.textContent = css
  document.head.appendChild(tag)
}
