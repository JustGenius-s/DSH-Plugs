import type { SVGProps } from 'react'

/** Outline bug-play, 16-grid, currentColor — same weight as official command glyphs. */
export function IconDebugOutline16(props: SVGProps<SVGSVGElement>) {
  const size = props.width ?? props.height ?? 16
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M6.6 13.1A4 4 0 0 1 4 9.35V7.35A2.65 2.65 0 0 1 6.65 4.7h2.7A2.65 2.65 0 0 1 12 7.33" />
      <path d="M9.35 9.35a.65.65 0 0 1 1.01-.57l3.33 2A.65.65 0 0 1 13.7 12l-3.33 2a.65.65 0 0 1-1.02-.58z" />
      <path d="m9.4 2.55 1.25-1.25M14 3.35a2.65 2.65 0 0 1-2.37 2.65M2 14a2.65 2.65 0 0 1 2.54-2.67M2 3.35a2.65 2.65 0 0 0 2.37 2.65M4 8.7H1.35m4-7.35L6.6 2.55M6 4.75V4A2 2 0 1 1 10 4v.75" />
    </svg>
  )
}
