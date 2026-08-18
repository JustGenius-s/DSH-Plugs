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

/** Lucide `picture-in-picture-2`, per the design request. */
function IconPictureInPicture2({ size = 16 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4" />
      <rect width="10" height="7" x="12" y="13" rx="2" />
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
