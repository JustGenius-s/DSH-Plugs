// Styles for the dsh-codex side-chat panel.
//
// Visual parity with the DSH main conversation: the user bubble, assistant
// markdown, tool cards and the composer card reuse the exact same `--dsw-*`
// tokens and geometry as `ui-conversation`'s chat (`gdEzaW_bubble`,
// `uV2eYG_card`) and InputBar. Side-chat content fills the side panel's width
// instead of the 748px main-column width, but the surfaces, fonts, radii and
// colors are one-to-one with the main chat.

import { fitRulesFor, injectStyles } from '@just-genius/dsh-plugin-ui'

// Assistant answers, tool output and terminal blocks render through the
// forwarded `dsh-client-ui-primitives` components, whose own CSS modules are
// NOT injected into a plugin bundle (see packages/ui/src/primitives-fit.ts).
// Without these rules the browser's defaults apply and a default <pre> never
// wraps, so any long code line pushes a horizontal scrollbar into the side
// panel. Scoping the shared fit rules to this feature's own containers keeps
// every surface reflowing to the panel width.
const FIT_SELECTORS = [
  '.dsh-codex-sidechat-md-body',
  '.dsh-codex-sidechat-toolresult',
  '.dsh-codex-sidechat-toolrow-body',
  '.dsh-codex-sidechat-think-body',
  '.dsh-codex-sidechat-user-bubble',
  '.dsh-codex-sidechat-irq-body',
  '.dsh-codex-sidechat-sources',
  '.dsh-codex-sidechat-empty-context',
]

const CSS = `
${fitRulesFor(FIT_SELECTORS)}
.dsh-codex-sidechat{display:flex;flex-direction:column;flex:1;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family)}
.dsh-codex-sidechat-error{display:flex;align-items:flex-start;gap:8px;padding:8px 16px;color:var(--dsw-alias-state-error-primary);font-size:13px;line-height:20px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none}
/* Message over an optional stack: a long trace must not squeeze the dismiss
   button out, and the bar stays single-line when there is no stack. */
.dsh-codex-sidechat-error-body{flex:1;min-width:0}
.dsh-codex-sidechat-error-message{display:block;overflow-wrap:anywhere}
.dsh-codex-sidechat-error-stackwrap{margin-top:4px}
.dsh-codex-sidechat-error-stackwrap summary{cursor:pointer;color:var(--dsw-alias-label-secondary,#b0b0b5);font-size:11px;font-weight:600}
.dsh-codex-sidechat-error-stack{max-height:200px;margin:4px 0 0;padding:6px 8px;overflow:auto;border-radius:6px;background:var(--dsw-alias-bg-overlay,rgba(0,0,0,.28));color:var(--dsw-alias-label-secondary,#b0b0b5);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:16px;white-space:pre;tab-size:2}
.dsh-codex-sidechat-error-dismiss{flex:none;border:none;background:transparent;color:inherit;cursor:pointer;font-size:13px;line-height:20px;padding:0 4px}
.dsh-codex-sidechat-empty-panel{flex:1;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.dsh-codex-sidechat-empty-panel p{margin:0}

/* Conversation flow: same vertical rhythm and font as the main chat.
   min-width:0 on every level lets the flow shrink below its content's
   intrinsic width — without it a long code line forces the column wider and
   the transcript grows a horizontal scrollbar. */
.dsh-codex-sidechat-conversation{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0}
.dsh-codex-sidechat-transcript-wrap{position:relative;flex:1;min-height:0;min-width:0;display:flex;flex-direction:column}
/* overflow-x:clip (not hidden) keeps this a pure vertical scroller: clip
   creates no scroll container, so it cannot be scrolled programmatically and
   never shows a scrollbar. hidden would still allow programmatic scroll. */
.dsh-codex-sidechat-transcript{flex:1;min-height:0;min-width:0;overflow-y:auto;overflow-x:clip;padding:16px;display:flex;flex-direction:column;gap:16px;container-type:inline-size}

/* User bubble — one-to-one with the main chat's gdEzaW_bubble. */
.dsh-codex-sidechat-user{flex-direction:column;align-items:flex-end;gap:6px;display:flex;min-width:0}
.dsh-codex-sidechat-user-bubble{background:var(--dsw-specific-bubble);max-width:min(525px,82%);color:var(--dsw-alias-label-primary);border-radius:22px;padding:10px 16px;font-size:16px;line-height:24px;white-space:pre-wrap;word-break:break-word}
/* A queued message is accepted but has not entered the log yet: it must be
   visibly "on its way" rather than indistinguishable from a durable turn. */
.dsh-codex-sidechat-user-bubble.is-pending{opacity:.62}

/* Assistant markdown — Sxvs8a: 16/28, 16px stack gap. */
.dsh-codex-sidechat-md{color:var(--dsw-alias-label-primary);flex-direction:column;font-size:16px;line-height:28px;display:flex;min-width:0}
.dsh-codex-sidechat-md-body{flex-direction:column;gap:16px;display:flex;min-width:0}
.dsh-codex-sidechat-stopped{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);border-radius:6px;align-self:flex-start;padding:0 6px;font-size:11px;line-height:18px}

/* Think row — QWLzlG DisclosureRow + sweep while running. */
.dsh-codex-sidechat-think{flex-direction:column;display:flex}
.dsh-codex-sidechat-think-row{position:relative;overflow:hidden}
.dsh-codex-sidechat-think[data-state=running] .dsh-codex-sidechat-think-row:after{content:"";inset-block:0;background:linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent) 55%, transparent 100%);pointer-events:none;width:300px;animation:2.6s ease-out infinite dsh-codex-sidechat-row-sweep;position:absolute;left:0}
.dsh-codex-sidechat-think-leading{flex-shrink:0}
.dsh-codex-sidechat-think-chevron{color:var(--dsw-alias-label-secondary)}
.dsh-codex-sidechat-think-title{font-weight:400}
.dsh-codex-sidechat-sep{background:var(--dsw-alias-label-caption);border-radius:1px;flex:none;width:2px;height:2px;margin:0 8px}
.dsh-codex-sidechat-think-summary{min-width:0;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;flex:auto;font-size:14px;line-height:24px;overflow:hidden}
.dsh-codex-sidechat-think-summary[data-follow-end]{text-overflow:clip}
.dsh-codex-sidechat-think-body{color:var(--dsw-alias-label-tertiary);white-space:pre-wrap;word-break:break-word;padding:4px 0 4px 22px;font-size:14px;line-height:24px}

/* Forwarded primitive cards (TerminalBlock / CodeBlock / ReadBlock / DiffBlock
   / SearchBlock from dsh-client-ui-primitives). Their own sheets are now
   injected, so these rules only ADAPT them to a narrow side panel — they must
   not restyle them.
   - Each card reserves its own left inset (terminal: 30px run-state column;
     read: 48px line-number column). On top of the tool row's 22px indent that
     is too much of a side panel to spend, so the wrapper reclaims it with a
     negative margin and the cards keep their internal geometry intact.
   - Cards get a content height so a long read / diff / search collapses inside
     its own card instead of pushing the transcript to an unusable length.
   - min-width:0 lets a card shrink below its content's intrinsic width. */
.dsh-codex-sidechat-terminal{min-width:0;max-width:100%;margin:4px 0 4px 22px}
/* Match the main chat's terminal card (ui-tool ToolRow .terminalBody):
   the smaller monospace face, 18px line height, a 224px output scroll cap, and
   a hairline border. The earlier build set only a 320px height with no font or
   border, so the card read as plain wrapped text instead of a terminal. The
   gutter is narrowed for the side panel's extra 22px indent (the run-state dot
   moves into the row indent, content geometry intact). */
.dsh-codex-sidechat-terminal > *{
  --dsl-terminal-font:var(--dsw-font-markdown-code-block-small);
  --dsl-terminal-line-height:18px;
  --dsl-terminal-output-max-height:224px;
  --dsl-terminal-gutter:14px;
  --dsl-terminal-radius:10px;
  border:.5px solid var(--dsw-alias-border-l1);
}
.dsh-codex-sidechat-code{min-width:0;max-width:100%;margin-left:22px}

/* Tool row — o3BgMG DisclosureRow + sweep while running. */
.dsh-codex-sidechat-toolrow{flex-direction:column;display:flex}
.dsh-codex-sidechat-toolrow-row{position:relative;overflow:hidden}
.dsh-codex-sidechat-toolrow[data-state=running] .dsh-codex-sidechat-toolrow-row:after{content:"";background:linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent) 55%, transparent 100%);pointer-events:none;width:300px;animation:2.6s ease-out infinite dsh-codex-sidechat-row-sweep;position:absolute;top:0;bottom:0;left:0}
.dsh-codex-sidechat-toolrow-leading{flex-shrink:0}
.dsh-codex-sidechat-toolrow-chevron{color:var(--dsw-alias-label-secondary)}
.dsh-codex-sidechat-toolrow-title{font-weight:400}
.dsh-codex-sidechat-toolrow-summary{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-tertiary);flex:auto;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px));overflow:hidden}
.dsh-codex-sidechat-toolrow-summary.is-error{color:var(--dsw-alias-state-error-primary)}
/* Nested-call count: how many child calls this root owns. */
.dsh-codex-sidechat-toolrow-badge{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-caption);border-radius:6px;flex:none;padding:0 5px;margin-right:8px;font-size:11px;font-weight:600;line-height:18px}
/* Explicit running marker — the sweep animation alone reads as decoration. */
.dsh-codex-sidechat-toolrow-state{color:var(--dsw-alias-label-caption);flex:none;margin-right:8px;font-size:12px;line-height:18px}
.dsh-codex-sidechat-toolrow-body{color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;padding:4px 0 4px 22px;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px))}
.dsh-codex-sidechat-toolrow-body.is-error{color:var(--dsw-alias-state-error-primary)}
/* Structured result cards (read / search / web / diff).

   Single source of truth for this class: two same-specificity rules previously
   split its geometry between them and left these cards misaligned.

   The 22px indent matches .toolrow-body/.think-body, so an expanded card sits
   one level in from its tool-row title — the same indent the row's own text
   body uses. DisclosureRow's children slot carries NO padding of its own, so
   the card needs this indent supplied here; a negative margin here would pull
   the card outside the content box and pin it to the panel edge.

   The official read card's own 48px line-number gutter is tightened to 36px
   so a narrow panel keeps more of the code. */
.dsh-codex-sidechat-toolresult{display:flex;flex-direction:column;gap:6px;min-width:0;max-width:100%;margin-left:22px}
.dsh-codex-sidechat-toolresult :where(*){--dsl-read-gutter:36px}
.dsh-codex-sidechat-toolresult-caption{color:var(--dsw-alias-label-caption);font-family:var(--ds-font-family-code);word-break:break-all;font-size:12px;line-height:18px}
/* Nested tool calls: inset one level under their root. */
.dsh-codex-sidechat-subcalls{display:flex;flex-direction:column;gap:2px;padding:2px 0 2px 22px;min-width:0}
/* Web result citations. */
.dsh-codex-sidechat-sources{display:flex;flex-direction:column;gap:8px;list-style:none;margin:4px 0;padding:0 0 0 22px;min-width:0}
.dsh-codex-sidechat-source{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-codex-sidechat-source-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:20px}
.dsh-codex-sidechat-source-link{color:var(--dsw-alias-state-business-primary);word-break:break-all;font-size:12px;line-height:18px}
.dsh-codex-sidechat-source-snippet{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
/* Injected context / recall rows. */
.dsh-codex-sidechat-context{flex-direction:column;display:flex}
/* Durable message images. */
.dsh-codex-sidechat-images{display:flex;flex-wrap:wrap;gap:6px;padding-top:6px}
.dsh-codex-sidechat-image{max-width:100%;max-height:220px;border-radius:8px;object-fit:contain}
.dsh-codex-sidechat-image.is-loading,.dsh-codex-sidechat-image.is-error{display:inline-flex;align-items:center;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);padding:8px 10px;font-size:12px;line-height:18px}
.dsh-codex-sidechat-image.is-error{color:var(--dsw-alias-state-error-primary)}
@keyframes dsh-codex-sidechat-row-sweep{0%{left:-300px}90%,to{left:100%}}
@media (prefers-reduced-motion:reduce){
  .dsh-codex-sidechat-think[data-state=running] .dsh-codex-sidechat-think-row:after,
  .dsh-codex-sidechat-toolrow[data-state=running] .dsh-codex-sidechat-toolrow-row:after{animation:none}
}

.dsh-codex-sidechat-status-row{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.dsh-codex-sidechat-status-row.is-error{color:var(--dsw-alias-state-error-primary)}

/* Running turn — Md3f7G_turnStatus shimmer. */
.dsh-codex-sidechat-turn-status{height:26px;font:var(--dsw-font-s-strong-14);white-space:nowrap;background:linear-gradient(90deg, var(--dsw-static-deepseek-500) 0%, var(--dsw-static-deepseek-500) 40%, var(--dsw-static-deepseek-200) 50%, var(--dsw-static-deepseek-500) 60%, var(--dsw-static-deepseek-500) 100%);color:#0000;-webkit-text-fill-color:transparent;background-position:100% 0;background-size:250% 100%;-webkit-background-clip:text;background-clip:text;flex:none;align-self:flex-start;align-items:center;animation:1.8s linear infinite dsh-codex-sidechat-turn-shimmer;display:inline-flex}
.dsh-codex-sidechat-turn-clock{font:var(--dsw-font-xs-13);font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-caption);-webkit-text-fill-color:var(--dsw-alias-label-caption);margin-left:8px;font-weight:400}
@keyframes dsh-codex-sidechat-turn-shimmer{to{background-position:0 0}}
@media (prefers-reduced-motion:reduce){.dsh-codex-sidechat-turn-status{background-position:0 0;background-size:100% 100%;animation:none}}

/* Jump-to-bottom — Md3f7G_toBottom floating chevron. */
.dsh-codex-sidechat-to-bottom-slot{z-index:8;height:0;pointer-events:none;justify-content:flex-end;display:flex;position:sticky;bottom:16px}
.dsh-codex-sidechat-to-bottom{border:1px solid var(--dsw-alias-border-l2);width:34px;height:34px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-floating-fill);box-shadow:var(--dsw-shadow-lv2);cursor:pointer;pointer-events:auto;border-radius:100px;justify-content:center;align-items:center;margin-top:-34px;margin-right:8px;padding:0;display:flex}
.dsh-codex-sidechat-to-bottom:hover{background:var(--dsw-alias-button-floating-hover)}
/* Empty state: a centered COLUMN. The hero and the context block stack
   vertically; a row container (the flex default) lays them side-by-side. */
.dsh-codex-sidechat-empty{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;text-align:center}
.dsh-codex-sidechat-empty-hero{max-width:280px;display:flex;flex-direction:column;align-items:center;gap:8px}
.dsh-codex-sidechat-empty-icon{color:var(--dsw-alias-label-tertiary);flex:none;margin-bottom:4px}
.dsh-codex-sidechat-empty-title{margin:0;color:var(--dsw-alias-label-primary);font-size:20px;font-weight:600;line-height:28px}
.dsh-codex-sidechat-empty-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;font-weight:400;line-height:20px}
/* Inherited-context rows under the empty hero. Centered to match the hero, and
   capped to the hero's width so the block reads as one grouped unit rather than
   a full-width band stretching past the centered copy. */
.dsh-codex-sidechat-empty-context{width:100%;max-width:280px;display:flex;flex-direction:column;gap:4px;text-align:left;min-width:0}
/* Context badge: whether the main conversation came along. */
.dsh-codex-sidechat-context-note{display:inline-flex;align-items:center;justify-content:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dsh-codex-sidechat-context-note[data-context=inherited]{color:var(--dsw-alias-label-secondary)}

/* Composer — one-to-one with the main InputBar's uV2eYG_card:
   --dsw-specific-input-major fill, l2-darkmode-thin hairline, 22px radius,
   lv2 shadow, 16px/24px font, 10px top padding + 12px gap. */
.dsh-codex-sidechat-composer{flex:none;padding:0 12px 12px;display:flex;flex-direction:column;gap:12px}
.dsh-codex-sidechat-attachments{display:flex;flex-wrap:wrap;gap:6px;padding-top:10px}
.dsh-codex-sidechat-attachment-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px}
.dsh-codex-sidechat-attachment-remove{border:none;background:transparent;color:inherit;cursor:pointer;font-size:12px;line-height:16px;padding:0}
.dsh-codex-sidechat-attachment-remove:hover{color:var(--dsw-alias-state-error-primary)}
/* The chip shows the draft's real thumbnail, so it is sized like the main
   composer's preview rather than being a text pill. */
.dsh-codex-sidechat-attachment-thumb{display:block;width:20px;height:20px;border-radius:4px;object-fit:cover;flex:none}
.dsh-codex-sidechat-attachment-fallback{font-size:12px;line-height:16px}
.dsh-codex-sidechat-attachment-name{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.dsh-codex-sidechat-card{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l2-darkmode-thin);background:var(--dsw-specific-input-major);box-shadow:var(--dsw-shadow-lv2);border-radius:22px;display:flex;flex-direction:column;gap:12px;padding-top:10px;font-size:16px;line-height:24px;position:relative}
.dsh-codex-sidechat-composer-input{box-sizing:border-box;width:100%;resize:none;border:none;background:transparent;color:var(--dsw-alias-label-primary);caret-color:var(--dsw-alias-state-business-primary);padding:4px 16px 0;font-family:inherit;font-size:16px;line-height:24px;outline:none}
.dsh-codex-sidechat-composer-input::placeholder{color:var(--dsw-alias-label-tertiary)}

/* Tool row — uV2eYG_row + tools/trailing: 2/8/6 padding, left gap 16, right gap 12. */
.dsh-codex-sidechat-composer-tools{justify-content:space-between;align-items:center;gap:12px;min-width:0;padding:2px 8px 6px;display:flex;container-type:inline-size}
.dsh-codex-sidechat-tools-left{align-items:center;min-width:0;display:flex;gap:8px}
.dsh-codex-sidechat-tools-right{align-items:center;min-width:0;display:flex;flex:none;gap:12px}

/* "+" attach button — uV2eYG_add: selector fill, 28x28, round, primary ink. */
.dsh-codex-sidechat-add{background:var(--dsw-specific-selector);width:28px;height:28px;color:var(--dsw-alias-label-primary);cursor:pointer;border:none;border-radius:999px;flex:none;place-items:center;display:grid}
.dsh-codex-sidechat-add:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}
.dsh-codex-sidechat-add:disabled{opacity:.5;cursor:default}

/* Model select trigger — uV2eYG_select: secondary ink, 8px radius, chevron padding. */
.dsh-codex-sidechat-select{max-width:min(280px,45cqw);height:28px;color:var(--dsw-alias-label-secondary);white-space:nowrap;cursor:pointer;background-color:transparent;border:none;border-radius:8px;outline:none;padding:0 8px;font-size:13px;font-weight:500;line-height:20px;display:inline-flex;align-items:center;gap:4px;position:relative}
.dsh-codex-sidechat-select:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-codex-sidechat-select:disabled{opacity:.5;cursor:default}
.dsh-codex-sidechat-select-label{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}
.dsh-codex-sidechat-select-effort{color:var(--dsw-alias-label-caption);flex:none}

/* Permission chip — filled capsule like the Codex composer: selector fill,
   fully rounded ends, leading glyph + label, no chevron. */
.dsh-codex-sidechat-perm-wrap{display:inline-flex;min-width:0;align-items:center}
.dsh-codex-sidechat-perm{min-width:0;max-width:220px;height:24px;color:var(--dsw-alias-label-primary);cursor:pointer;background:var(--dsw-specific-selector);border:none;border-radius:999px;outline:none;align-items:center;gap:6px;padding:0 10px 0 8px;font-size:13px;font-weight:500;line-height:20px;display:inline-flex}
.dsh-codex-sidechat-perm:hover:not(:disabled){filter:brightness(.96)}
.dsh-codex-sidechat-perm:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.dsh-codex-sidechat-perm:disabled{opacity:.45;cursor:default}
.dsh-codex-sidechat-perm-icon{flex:none;display:inline-flex}
.dsh-codex-sidechat-perm-icon svg{width:14px;height:14px}
.dsh-codex-sidechat-perm-label{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}
@container (width<=460px){
  .dsh-codex-sidechat-perm:has(.dsh-codex-sidechat-perm-icon){width:24px;min-width:24px;padding:0;gap:0;justify-content:center;flex:none}
  .dsh-codex-sidechat-perm:has(.dsh-codex-sidechat-perm-icon) .dsh-codex-sidechat-perm-label{display:none}
}

/* Chevron rotation (matches the main model select trigger). */
.dsh-codex-sidechat-chevron{color:var(--dsw-alias-label-caption);flex:none;transition:transform .12s}
.dsh-codex-sidechat-chevron-open{transform:rotate(180deg)}

/* Model select menu — one-to-one with the main session's Ra_menu:
   wider card (max 420px / 360px scrollable list), provider group titles,
   options with model names, checkmark on the selected one. */
.dsh-codex-sidechat-model-root{min-width:0;position:relative}
.dsh-codex-sidechat-model-menu{z-index:20;border:1px solid var(--dsw-alias-border-inverted);background:var(--dsw-specific-menu);width:max-content;min-width:min(240px,100vw - 32px);max-width:min(420px,100vw - 32px);max-height:min(360px,100vh - 96px);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border-radius:12px;display:flex;flex-direction:column;padding:4px;position:absolute;bottom:calc(100% + 8px);right:0;overflow:hidden}
.dsh-codex-sidechat-model-error{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);border-radius:8px;margin-bottom:4px;padding:7px 8px;font-size:12px;line-height:18px}
/* Provider failure detail under an empty-directory notice; secondary so the
   headline stays readable while the cause is still legible. */
.dsh-codex-sidechat-model-error-detail{display:block;margin-top:3px;opacity:.85;font-size:11px;line-height:16px}
.dsh-codex-sidechat-model-groups{min-height:0;overflow-y:auto}
.dsh-codex-sidechat-model-group + .dsh-codex-sidechat-model-group{margin-top:4px}
.dsh-codex-sidechat-model-group-title{z-index:1;background:var(--dsw-specific-menu);color:var(--dsw-alias-label-tertiary);padding:5px 8px 3px;font-size:12px;font-weight:500;line-height:18px;position:sticky;top:0}
.dsh-codex-sidechat-model-option{box-sizing:border-box;width:auto;min-width:100%;min-height:38px;color:inherit;text-align:left;cursor:pointer;background:transparent;border:none;border-radius:10px;outline:none;display:flex;align-items:center;gap:8px;padding:6px 8px}
.dsh-codex-sidechat-model-option:hover:not(:disabled),.dsh-codex-sidechat-model-option:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-codex-sidechat-model-option-selected{background:transparent}
.dsh-codex-sidechat-model-option-copy{flex:1;min-width:0;display:flex;flex-direction:column}
.dsh-codex-sidechat-model-name{color:inherit;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:20px;overflow:hidden}
.dsh-codex-sidechat-model-desc{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:400;line-height:18px;overflow:hidden}
.dsh-codex-sidechat-model-check{color:var(--dsw-alias-label-primary);flex:0 0 18px;place-items:center;display:grid}
.dsh-codex-sidechat-model-root-pane{display:flex;flex-direction:column;padding:2px 0}
.dsh-codex-sidechat-model-cell{box-sizing:border-box;width:100%;min-height:38px;color:inherit;text-align:left;cursor:pointer;background:transparent;border:none;border-radius:10px;outline:none;display:flex;align-items:center;gap:8px;padding:6px 8px}
.dsh-codex-sidechat-model-cell:hover,.dsh-codex-sidechat-model-cell:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-codex-sidechat-model-cell-label{color:var(--dsw-alias-label-primary);flex:none;font-size:14px;font-weight:500;line-height:20px}
.dsh-codex-sidechat-model-cell-value{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:auto;text-align:right;font-size:13px;line-height:20px;overflow:hidden}
.dsh-codex-sidechat-model-cell-chevron{color:var(--dsw-alias-label-caption);flex:none}
.dsh-codex-sidechat-model-empty{color:var(--dsw-alias-label-tertiary);padding:8px;font-size:13px;line-height:20px}

/* Round send button — uV2eYG_primary: info fill, white, 34x34, round, -2px lift. */
.dsh-codex-sidechat-primary{background:var(--dsw-alias-button-info-fill);color:#fff;cursor:pointer;border:none;border-radius:999px;flex:none;place-items:center;width:34px;height:34px;transition:background-color .1s;display:grid;transform:translateY(-2px)}
.dsh-codex-sidechat-primary:hover:not(:disabled){background:var(--dsw-alias-button-info-hover)}
.dsh-codex-sidechat-primary:disabled{opacity:.45;cursor:default}

/* Interrupt takeover — approval / ask_user_question occupy the composer. */
.dsh-codex-sidechat-irq{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l2-darkmode-thin);background:var(--dsw-specific-input-major);box-shadow:var(--dsw-shadow-lv2);border-radius:20px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;overflow:hidden;max-height:min(60vh,520px)}
.dsh-codex-sidechat-irq-warn{border-color:var(--dsw-alias-state-warn-secondary)}
.dsh-codex-sidechat-irq-min{max-height:none}
.dsh-codex-sidechat-irq-strip{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-primary);align-items:center;gap:8px;padding:10px 16px;font-size:13px;line-height:18px;display:flex;flex:none}
.dsh-codex-sidechat-irq-dot{background:var(--dsw-alias-state-warn-primary);border-radius:50%;width:8px;height:8px;flex:none}
.dsh-codex-sidechat-irq-header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:16px 12px 0 16px;flex:none}
.dsh-codex-sidechat-irq-min .dsh-codex-sidechat-irq-header{padding-bottom:14px}
.dsh-codex-sidechat-irq-heading{min-width:0}
.dsh-codex-sidechat-irq-eyebrow{color:var(--dsw-alias-label-tertiary);margin-bottom:4px;font-size:11px;line-height:16px}
.dsh-codex-sidechat-irq-title{margin:0;font-size:16px;font-weight:500;line-height:22px}
.dsh-codex-sidechat-irq-header-actions{display:flex;align-items:center;gap:4px;flex:none}
.dsh-codex-sidechat-irq-icon{border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;width:28px;height:28px;border-radius:8px;display:grid;place-items:center;padding:0}
.dsh-codex-sidechat-irq-icon:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-codex-sidechat-irq-icon:disabled{opacity:.4;cursor:default}
.dsh-codex-sidechat-irq-body{box-sizing:border-box;display:flex;flex-direction:column;gap:8px;padding:12px 16px 0;min-height:0}
.dsh-codex-sidechat-irq-scroll{overflow-y:auto;flex:auto}
.dsh-codex-sidechat-irq-headline{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:500;line-height:24px}
.dsh-codex-sidechat-irq-command{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);word-break:break-all;font-size:13px;line-height:20px}
.dsh-codex-sidechat-irq-detail{margin:0 0 8px}
.dsh-codex-sidechat-irq-options{display:flex;flex-direction:column;gap:2px}
.dsh-codex-sidechat-irq-option,.dsh-codex-sidechat-irq-custom{width:100%;min-height:40px;color:inherit;text-align:left;cursor:pointer;background:transparent;border:1px solid transparent;border-radius:12px;align-items:flex-start;gap:8px;padding:8px;display:flex}
.dsh-codex-sidechat-irq-option:hover:not(:disabled),.dsh-codex-sidechat-irq-option.is-selected,.dsh-codex-sidechat-irq-custom:hover,.dsh-codex-sidechat-irq-custom.is-active{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-codex-sidechat-irq-option.is-selected,.dsh-codex-sidechat-irq-custom.is-active{border-color:var(--dsw-alias-border-l2)}
.dsh-codex-sidechat-irq-num{background:var(--dsw-alias-bg-overlay);width:20px;height:20px;color:var(--dsw-alias-label-secondary);border-radius:6px;flex:none;place-items:center;margin-top:2px;font-size:12px;font-weight:500;display:grid}
.dsh-codex-sidechat-irq-check{width:20px;height:20px;flex:none;place-items:center;margin-top:2px;display:grid;position:relative}
.dsh-codex-sidechat-irq-check:before{content:"";border:1px solid var(--dsw-alias-border-l4);border-radius:4px;width:14px;height:14px;grid-area:1/1}
.dsh-codex-sidechat-irq-check.is-on{color:var(--dsw-alias-label-primary-foreground)}
.dsh-codex-sidechat-irq-check.is-on:before{border-color:var(--dsw-alias-label-primary);background:var(--dsw-alias-label-primary)}
.dsh-codex-sidechat-irq-check svg{grid-area:1/1}
.dsh-codex-sidechat-irq-option-copy{flex:1;min-width:0}
.dsh-codex-sidechat-irq-option-line{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 6px}
.dsh-codex-sidechat-irq-option-label{font-size:14px;font-weight:500;line-height:24px}
.dsh-codex-sidechat-irq-badge{background:var(--dsw-specific-sidebar-nav-item-active-accent);color:var(--dsw-alias-button-info-fill);border-radius:6px;padding:0 4px;font-size:11px;font-weight:600;line-height:18px}
.dsh-codex-sidechat-irq-option-desc{color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:24px}
.dsh-codex-sidechat-irq-custom{cursor:text}
.dsh-codex-sidechat-irq-field{flex:1;min-width:0;resize:none;border:none;background:transparent;color:var(--dsw-alias-label-primary);caret-color:var(--dsw-alias-state-business-primary);font:inherit;font-size:14px;line-height:24px;outline:none}
.dsh-codex-sidechat-irq-field.is-block{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);border-radius:10px;min-height:64px;padding:8px 12px;margin:0 4px}
.dsh-codex-sidechat-irq-field::placeholder{color:var(--dsw-alias-label-caption)}
.dsh-codex-sidechat-irq-footer{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;padding:10px 12px 12px;flex:none}
.dsh-codex-sidechat-irq-pager{display:flex;align-items:center;gap:4px;flex:none}
.dsh-codex-sidechat-irq-progress{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;white-space:nowrap}
.dsh-codex-sidechat-irq-footer-actions,.dsh-codex-sidechat-irq-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex:none;padding:0 16px 14px}
.dsh-codex-sidechat-irq-footer .dsh-codex-sidechat-irq-footer-actions{padding:0}
.dsh-codex-sidechat-irq-error{min-height:16px;color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:16px;padding:0 16px 4px}
.dsh-codex-sidechat-irq-footer .dsh-codex-sidechat-irq-error{padding:0;flex:1;text-align:right}
.dsh-codex-sidechat-irq-reject:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);border-color:transparent}
`

/** Inject or refresh the side-chat stylesheet. */
export function ensureSideChatStyles(): void {
  injectStyles('@just-genius/dsh-codex', '@just-genius/dsh-codex/side-chat.css', CSS)
}
