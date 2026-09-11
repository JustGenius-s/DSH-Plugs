const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const ICON_MARKER = 'data-dsh-session-archive-icon'

export function installArchiveSettingsIcon(getLabel: () => string): () => void {
  const originals = new Map<HTMLButtonElement, SVGElement>()
  const body = document.body
  if (body === null) return () => {}

  const sync = (): void => {
    for (const button of originals.keys()) {
      if (!button.isConnected) originals.delete(button)
    }

    const label = getLabel().trim()
    if (label.length === 0) return

    for (const button of body.querySelectorAll<HTMLButtonElement>('nav button')) {
      const hasLabel = Array.from(button.querySelectorAll('span')).some(
        (span) => span.textContent?.trim() === label,
      )
      if (!hasLabel) continue

      const currentIcon = button.querySelector<SVGElement>('svg')
      if (currentIcon === null || currentIcon.hasAttribute(ICON_MARKER)) continue

      if (!originals.has(button)) {
        originals.set(button, currentIcon.cloneNode(true) as SVGElement)
      }
      currentIcon.replaceWith(createArchiveIcon(currentIcon))
    }
  }

  sync()
  const observer = new MutationObserver(sync)
  observer.observe(body, { childList: true, subtree: true, characterData: true })

  return () => {
    observer.disconnect()
    for (const [button, original] of originals) {
      const currentIcon = button.querySelector<SVGElement>(`svg[${ICON_MARKER}]`)
      if (currentIcon !== null) currentIcon.replaceWith(original)
    }
  }
}

function createArchiveIcon(source: SVGElement): SVGElement {
  const icon = document.createElementNS(SVG_NAMESPACE, 'svg')
  for (const attribute of Array.from(source.attributes)) {
    icon.setAttribute(attribute.name, attribute.value)
  }
  icon.setAttribute(ICON_MARKER, 'true')
  icon.setAttribute('viewBox', '0 0 16 16')
  icon.setAttribute('fill', 'none')
  icon.setAttribute('stroke', 'currentColor')
  icon.setAttribute('stroke-width', '1.4')
  icon.setAttribute('stroke-linecap', 'round')
  icon.setAttribute('stroke-linejoin', 'round')
  icon.setAttribute('aria-hidden', 'true')
  icon.setAttribute('focusable', 'false')
  icon.replaceChildren(...createArchiveGlyph())
  return icon
}

function createArchiveGlyph(): SVGElement[] {
  const box = document.createElementNS(SVG_NAMESPACE, 'path')
  box.setAttribute('d', 'M2.5 5.5h11v7a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z')
  const lid = document.createElementNS(SVG_NAMESPACE, 'path')
  lid.setAttribute('d', 'M1.75 5.5 3 2.75h10L14.25 5.5')
  const slit = document.createElementNS(SVG_NAMESPACE, 'path')
  slit.setAttribute('d', 'M6.5 8.5h3')
  return [lid, box, slit]
}
