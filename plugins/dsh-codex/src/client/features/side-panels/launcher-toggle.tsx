/**
 * The session-header toggle for the collapsed launcher card.
 *
 * Registered into `conversation.session.header.actions`, so it sits in the
 * title-adjacent action row. It only appears while there is something to
 * toggle: the card is auto-hidden because it occludes the conversation, or a
 * manual override is in effect. Clicking flips between an explicit 'show' and
 * an explicit 'hide'; scrolling the conversation out from under the card
 * retires a 'show' override and the button disappears with it.
 */

import { useSyncExternalStore } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { launcherVisible, type LauncherStore } from './launcher-store'

/**
 * Picture-in-picture glyph, hand-drawn to the DSH fill-type spec (16px grid,
 * 1.35px frame via evenodd knockout) — the primitives sheet has no PiP mark.
 */
function IconPictureInPicture2({ size = 16 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M2.95 2.55H13.05C14.38 2.55 15.45 3.62 15.45 4.95V11.05C15.45 12.38 14.38 13.45 13.05 13.45H2.95C1.62 13.45 0.55 12.38 0.55 11.05V4.95C0.55 3.62 1.62 2.55 2.95 2.55ZM2.95 3.9H13.05C13.63 3.9 14.1 4.37 14.1 4.95V11.05C14.1 11.63 13.63 12.1 13.05 12.1H2.95C2.37 12.1 1.9 11.63 1.9 11.05V4.95C1.9 4.37 2.37 3.9 2.95 3.9Z"
        fill="currentColor"
      />
      <path
        d="M9.3 7.4h3a1.3 1.3 0 0 1 1.3 1.3v1.6a1.3 1.3 0 0 1-1.3 1.3h-3a1.3 1.3 0 0 1-1.3-1.3V8.7a1.3 1.3 0 0 1 1.3-1.3z"
        fill="currentColor"
      />
    </svg>
  )
}

export function LauncherToggle(props: unknown) {
  const { launcher, t } = props as {
    launcher: LauncherStore
    t: (key: string) => string
  }
  const snapshot = useSyncExternalStore(launcher.subscribe, launcher.getSnapshot)
  if (!snapshot.occluded && snapshot.override === null) return null
  const visible = launcherVisible(snapshot)
  const label = visible ? t('launcher.hide') : t('launcher.show')
  return (
    <Tooltip label={label} delayMs={500} side="bottom">
      <button
        type="button"
        className="dsh-side-panels-icon-button"
        aria-label={label}
        aria-pressed={visible}
        onClick={() => launcher.toggle()}
      >
        <IconPictureInPicture2 size={16} />
      </button>
    </Tooltip>
  )
}
