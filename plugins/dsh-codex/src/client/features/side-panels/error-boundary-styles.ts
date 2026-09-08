/** Styles for the side-panel error card (see error-boundary.tsx). */

const ERROR_BOUNDARY_CSS = `
.dsh-sidepanel-error{display:flex;flex-direction:column;gap:8px;min-height:0;overflow:auto;padding:10px 12px;color:var(--dsw-alias-label-primary,#e6e6e8);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:18px;background:var(--dsw-alias-interactive-bg-hover-danger,rgba(207,34,46,.08))}
.dsh-sidepanel-error-head{display:flex;align-items:center;gap:8px}
.dsh-sidepanel-error-title{flex:1;min-width:0;color:var(--dsw-alias-state-error-primary,#cf222e);font-family:inherit;font-size:13px;font-weight:600;line-height:20px}
.dsh-sidepanel-error-copy{flex:none;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:11px;line-height:16px;padding:2px 6px;cursor:pointer}
.dsh-sidepanel-error-copy:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
.dsh-sidepanel-error-message{white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-state-error-primary,#cf222e)}
.dsh-sidepanel-error-details{border-top:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));padding-top:6px}
.dsh-sidepanel-error-details summary{cursor:pointer;color:var(--dsw-alias-label-secondary,#b0b0b5);font:inherit;font-size:11px;font-weight:600}
.dsh-sidepanel-error-stack{max-height:220px;margin:6px 0 0;padding:8px;overflow:auto;border-radius:6px;background:var(--dsw-alias-bg-overlay,rgba(0,0,0,.28));color:var(--dsw-alias-label-secondary,#b0b0b5);font:inherit;font-size:11px;line-height:16px;white-space:pre;tab-size:2}
`

let installed = false

/** Inject the error-card styles once per page. */
export function ensureErrorBoundaryStyles(): void {
  if (installed || typeof document === 'undefined') return
  installed = true
  const style = document.createElement('style')
  style.textContent = ERROR_BOUNDARY_CSS
  document.head.appendChild(style)
}
