// Badge stylesheet, injected as a single <style data-plugin> tag following
// the same contract DSH client bundles use (idempotent; HMR removes tags by
// the data-plugin attribute). Colors ride DSH theme alias tokens; the two
// badge hues are product-fixed (deep blue = App, blue-violet = DSH runtime),
// matching the desktop update affordance.

const CSS = `
.dsh-desktop-update-row-host{position:relative}
.dsh-desktop-update{display:inline-flex;gap:4px;margin-left:auto;margin-right:8px;vertical-align:middle;flex:none}
.dsh-desktop-update-badge{height:18px;min-width:18px;width:18px;padding:0;line-height:0;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:9px;cursor:pointer;color:#fff;box-shadow:0 1px 4px rgba(0,0,0,.35);overflow:hidden;transition:width .18s var(--ds-ease-in-out,ease),padding .18s var(--ds-ease-in-out,ease)}
.dsh-desktop-update-badge-label{max-width:0;opacity:0;white-space:nowrap;font-size:11px;font-weight:500;line-height:18px;overflow:hidden;transition:max-width .18s var(--ds-ease-in-out,ease),opacity .15s ease}
.dsh-desktop-update-badge svg{transition:opacity .12s ease}
/* 悬浮展开成纯文字按钮（仅有更新态）：图标淡出，标签独占。 */
.dsh-desktop-update-badge-accent:hover{width:auto;padding:0 8px}
.dsh-desktop-update-badge-accent:hover svg{display:none}
.dsh-desktop-update-badge-accent:hover .dsh-desktop-update-badge-label{max-width:60px;opacity:1}
/* 有更新：品牌蓝（DSH 蓝色按钮同源 token）。 */
.dsh-desktop-update-badge-accent{background:var(--dsw-alias-button-info-fill,#4176e6)}
.dsh-desktop-update-badge-accent:hover{background:var(--dsw-alias-button-info-hover,#679efe)}
/* 无更新/全关：无色底 + 主题三级标签色的带圈问号，悬浮仅提亮，不展开。 */
.dsh-desktop-update-badge-quiet{background:transparent;box-shadow:none;color:var(--dsw-alias-label-tertiary,#8b8b90)}
.dsh-desktop-update-badge-quiet:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));color:var(--dsw-alias-label-secondary,#b0b0b5)}
.dsh-desktop-update-badge:focus-visible{outline:2px solid var(--dsw-alias-label-tertiary,#8b8b90);outline-offset:1px}
.dsh-desktop-update-panel{position:fixed;z-index:30;display:inline-flex;flex-direction:column;gap:10px;width:fit-content;min-width:196px;max-width:min(420px,calc(100vw - 24px));padding:12px;border-radius:12px;background:var(--dsw-alias-bg-layer-3,rgb(53,54,56));border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06));box-shadow:0 8px 28px rgba(0,0,0,.45);font-family:Inter,var(--dsw-font-family,sans-serif);color:var(--dsw-alias-label-primary,#e6e6e8);text-align:left}
/* 行是纵向流：第一行名字+版本，第二行动作按钮（左对齐）。
   有动作的行（update-rows）底部留出动作区高度；动作区绝对定位贴左下，
   不参与任何宽度计算——此前所有"超宽"都来自 wrap flex 里 basis:100%
   元素与容器宽度的循环反推，绝对定位从根上退出这个循环。 */
.dsh-desktop-update-row{position:relative;display:flex;align-items:center;padding-top:8px;box-shadow:inset 0 1px 0 var(--dsw-alias-border-l1,rgba(255,255,255,.06))}
.dsh-desktop-update-row:first-child{padding-top:0;box-shadow:none}
.dsh-desktop-update-row-has-actions{padding-bottom:36px}
.dsh-desktop-update-name{display:flex;align-items:center;gap:7px;min-width:0;font-size:13px;font-weight:500;white-space:nowrap}
/* 名称前的 checkbox 即「自动检查」开关：勾选色随产品色。 */
.dsh-desktop-update-name input[type="checkbox"]{margin:0;flex:none;cursor:pointer;accent-color:var(--dsw-alias-button-info-fill,#4176e6)}
.dsh-desktop-update-name-dsh input[type="checkbox"]{accent-color:#7c9dfd}
/* 名称用产品色。 */
.dsh-desktop-update-name-app{color:var(--dsw-alias-button-info-fill,#4176e6)}
.dsh-desktop-update-name-dsh{color:#7c9dfd}
.dsh-desktop-update-version{margin-left:auto;padding-left:10px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#b0b0b5);white-space:nowrap}
/* 动作区第二行、左对齐：skip 链接在前、Update 主按钮在后。 */
.dsh-desktop-update-actions{position:absolute;left:0;bottom:0;display:flex;align-items:center;gap:8px}
.dsh-desktop-update-primary{height:26px;padding:0 12px;border:none;border-radius:7px;font-size:12px;font-weight:500;line-height:26px;white-space:nowrap;cursor:pointer;color:#fff;background:var(--dsw-alias-button-info-fill,#4176e6)}
.dsh-desktop-update-primary:hover{background:var(--dsw-alias-button-info-hover,#679efe)}
.dsh-desktop-update-primary:disabled{opacity:.6;cursor:default}
.dsh-desktop-update-link{background:none;border:none;padding:0 4px;font-size:12px;cursor:pointer;color:var(--dsw-alias-label-primary,#e6e6e8);opacity:.75}
.dsh-desktop-update-link:hover{opacity:1}
.dsh-desktop-update-note{font-size:12px;color:var(--dsw-alias-label-secondary,#b0b0b5)}
`

/** Inject the stylesheet once; safe to call on every materialization. */
export function ensureBadgeStyles(): void {
  if (typeof document === 'undefined') return
  const tagId = '@just-genius/dsh-desktop-update/badge.css'
  if (document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = '@just-genius/dsh-desktop-update'
  tag.dataset.pluginCss = tagId
  tag.textContent = CSS
  document.head.appendChild(tag)
}
