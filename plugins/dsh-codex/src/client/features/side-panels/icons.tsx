/**
 * Panel glyphs for the collapsed launcher.
 *
 * Two sources, in this order of preference:
 *
 * 1. REUSE a native-compatible `ic_ds_*` glyph from the shared plugin UI
 *    whenever one carries the right meaning. Five of the seven names below
 *    are shared glyphs.
 * 2. HAND-DRAW to DSH's spec only where that sheet has no equivalent
 *    (terminal, git-graph, and the generic panel mark). Spec reverse-engineered
 *    from the same sheet:
 *      - 16x16 grid, `viewBox="0 0 16 16"`, `fill="none"` on the <svg>
 *      - every path `fill="currentColor"` — fill-type outlines, NOT stroked
 *        paths (that sheet is 130 fills vs 2 strokes), so a glyph never
 *        changes weight when the row scales
 *      - stroke weight 1.30-1.35px at this grid (measured: plus stem 1.300,
 *        browse rule 1.301, browse frame 1.350, search ring 1.376)
 *      - outer frames inset ~0.55px; butt ends, no round caps
 *      - layered shapes knock out via `evenodd`
 *
 * Deliberately not Phosphor/Lucide: those are stroke-type sets whose end-cap
 * and counter handling stay visibly "almost but not quite" DSH at 16px, and a
 * whole icon package is a poor trade for a handful of glyphs. A panel needing
 * something outside this set overrides with its own thunk (SidePanelDescriptor).
 */
import {
  IconBranchOutline16, IconChecklistOutline14, IconFolderOpenOutline16,
  IconGlobeOutline14, IconNewChatOutline16,
} from '@just-genius/dsh-plugin-ui'
import type { ReactNode } from 'react'

/** Props every panel glyph takes; mirrors primitives' `IconProps`. */
export interface PanelIconProps {
  /** Square edge in px. */
  size?: number | undefined
  /** Extra class for placement; color rides `currentColor`. */
  className?: string | undefined
}

/** Shared <svg> shell: fixes the grid, the fill mode and currentColor inheritance. */
function Glyph({ size = 16, className, children }: PanelIconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {children}
    </svg>
  )
}

/**
 * Terminal: rounded window frame with a prompt chevron and caret rule.
 * Hand-drawn — the native sheet has no terminal glyph. DSH marks terminal
 * surfaces with a `$` prompt instead (ui-primitives TerminalBlock), so the
 * chevron + rule reads as that prompt rather than inventing new symbolism.
 */
export function PanelIconTerminal(props: PanelIconProps) {
  return (
    <Glyph {...props}>
      {/* Window frame: DSH's fat corner radius (measured off
          ic_ds_browse_outline_16 — r/edge ~36% outer, ~33% inner) with the
          1.35 stroke knocked out via evenodd. */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M5.91 0.55H10.09C13.05 0.55 15.45 2.95 15.45 5.91V10.09C15.45 13.05 13.05 15.45 10.09 15.45H5.91C2.95 15.45 0.55 13.05 0.55 10.09V5.91C0.55 2.95 2.95 0.55 5.91 0.55ZM5.91 1.90H10.09C12.30 1.90 14.10 3.70 14.10 5.91V10.09C14.10 12.30 12.30 14.10 10.09 14.10H5.91C3.70 14.10 1.90 12.30 1.90 10.09V5.91C1.90 3.70 3.70 1.90 5.91 1.90Z"
        fill="currentColor"
      />
      {/* Prompt chevron. */}
      <path d="M5.05 6.16l.95-.95 2.24 2.24-2.24 2.24-.95-.95 1.29-1.29-1.29-1.29Z" fill="currentColor" />
      {/* Caret rule. */}
      <path d="M8.75 9.45h2.55v1.3H8.75v-1.3Z" fill="currentColor" />
    </Glyph>
  )
}

/**
 * Generic panel mark: the fallback when a panel reports no icon. Hand-drawn
 * mirror of `ic_ds_panel_left_outline_16` with the divider on the RIGHT, since
 * these panels dock right.
 */
export function PanelIconDefault(props: PanelIconProps) {
  return (
    <Glyph {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M5.91 0.55H10.09C13.05 0.55 15.45 2.95 15.45 5.91V10.09C15.45 13.05 13.05 15.45 10.09 15.45H5.91C2.95 15.45 0.55 13.05 0.55 10.09V5.91C0.55 2.95 2.95 0.55 5.91 0.55ZM5.91 1.90H10.09C12.30 1.90 14.10 3.70 14.10 5.91V10.09C14.10 12.30 12.30 14.10 10.09 14.10H5.91C3.70 14.10 1.90 12.30 1.90 10.09V5.91C1.90 3.70 3.70 1.90 5.91 1.90Z"
        fill="currentColor"
      />
      {/* Divider on the RIGHT: these panels dock right. */}
      <path d="M10.30 2.55h1.35v10.90H10.30V2.55Z" fill="currentColor" />
    </Glyph>
  )
}

/**
 * Commit graph: two stacked commits on the left, a full-height spine, and a
 * right-hand commit joining via a curved connector. Lucide's git-graph
 * composition, redrawn as DSH fill-type outlines so it sits with the rest
 * of the launcher column. Node rings copy `ic_ds_branch_outline_16`
 * (outer r 1.83, inner r 0.53, 1.30 stroke). Used for the Git panel's
 * Graph button/tab, not the panel itself.
 */
export function PanelIconGraph(props: PanelIconProps) {
  return (
    <Glyph {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M1.27 3.25a1.83 1.83 0 1 1 3.66 0a1.83 1.83 0 1 1-3.66 0M2.57 3.25a.53.53 0 1 0 1.06 0a.53.53 0 1 0-1.06 0"
        fill="currentColor"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M1.27 12.75a1.83 1.83 0 1 1 3.66 0a1.83 1.83 0 1 1-3.66 0M2.57 12.75a.53.53 0 1 0 1.06 0a.53.53 0 1 0-1.06 0"
        fill="currentColor"
      />
      {/* Stem overlaps each ring's stroke and stops at the hole. */}
      <path d="M2.45 3.78h1.3v8.44H2.45V3.78Z" fill="currentColor" />
      <path d="M7.35 1.42h1.3v13.16H7.35V1.42Z" fill="currentColor" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M11.07 3.25a1.83 1.83 0 1 1 3.66 0a1.83 1.83 0 1 1-3.66 0M12.37 3.25a.53.53 0 1 0 1.06 0a.53.53 0 1 0-1.06 0"
        fill="currentColor"
      />
      <path
        d="M8 11.57A5.63 5.63 0 0 0 13.54 4.97L12.26 5.19A4.33 4.33 0 0 1 8 10.27Z"
        fill="currentColor"
      />
    </Glyph>
  )
}

/**
 * The named glyphs a panel can request by string. Panels report a name
 * (`icon: 'terminal'`) so the host owns the drawing and every panel row stays
 * on one visual language; a panel needing something else passes a thunk.
 *
 * `files`, `browser`, `chat`, `command` and `git` are native `ic_ds_*` glyphs
 * verbatim — the open-folder, meridian-globe, new-chat, checklist and branch
 * marks DSH already uses for these meanings (checklist reads as a command
 * list, which is what a command panel shows; the branch mark is the canonical
 * source-control glyph). Globe and checklist are 14-grid glyphs upstream; the
 * size prop below still renders them at the row's 16px box.
 */
export const PANEL_ICONS = {
  terminal: PanelIconTerminal,
  git: IconBranchOutline16,
  files: IconFolderOpenOutline16,
  browser: IconGlobeOutline14,
  chat: IconNewChatOutline16,
  command: IconChecklistOutline14,
  panel: PanelIconDefault,
} as const

/** A glyph name from {@link PANEL_ICONS}. */
export type PanelIconName = keyof typeof PANEL_ICONS

/** Glyph size in a launcher row; matches primitives' menu `.itemIcon` box. */
const LAUNCHER_ICON_SIZE = 16

/**
 * Resolve a descriptor's `icon` to a rendered glyph.
 *
 * Precedence: a panel's own thunk wins (full escape hatch), then a known name,
 * then the generic panel mark — so every row carries a glyph and the column of
 * labels never ragged-edges between reporting and non-reporting panels.
 * @param icon - the reported `icon` value, or undefined when none was reported.
 * @returns the glyph element to place in the row.
 */
export function resolvePanelIcon(icon: PanelIconName | (() => unknown) | undefined): ReactNode {
  if (typeof icon === 'function') return icon() as ReactNode
  const Named = icon === undefined ? undefined : PANEL_ICONS[icon]
  const Resolved = Named ?? PanelIconDefault
  return <Resolved size={LAUNCHER_ICON_SIZE} />
}
