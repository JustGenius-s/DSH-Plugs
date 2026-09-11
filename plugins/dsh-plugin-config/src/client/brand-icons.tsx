import { PACK_LOGOS } from './pack-logos.ts'

/** Official brand marks (Cursor marketplace / vendor assets), 20×20, no network. */

export function PackBrandIcon(props: { id: string }) {
  const src = PACK_LOGOS[props.id]
  if (src) {
    return <img src={src} width={20} height={20} alt="" draggable={false} />
  }
  return <FallbackMark letter={props.id.slice(0, 1).toUpperCase()} />
}

function FallbackMark(props: { letter: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="var(--dsw-alias-bg-layer-2, #333)" />
      <text
        x="12"
        y="16"
        textAnchor="middle"
        fill="var(--dsw-alias-label-secondary, #999)"
        fontSize="11"
        fontWeight="700"
      >
        {props.letter}
      </text>
    </svg>
  )
}
