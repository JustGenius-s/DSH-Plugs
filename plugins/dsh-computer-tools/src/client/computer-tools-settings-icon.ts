const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const ICON_MARKER = 'data-dsh-computer-tools-icon'

export function installComputerToolsSettingsIcon(getLabel: () => string): () => void {
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
      currentIcon.replaceWith(createDesktopIcon(currentIcon))
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

function createDesktopIcon(source: SVGElement): SVGElement {
  const icon = document.createElementNS(SVG_NAMESPACE, 'svg')
  for (const attribute of Array.from(source.attributes)) {
    icon.setAttribute(attribute.name, attribute.value)
  }
  icon.setAttribute(ICON_MARKER, 'true')
  icon.setAttribute('viewBox', '0 0 16 16')
  icon.setAttribute('fill', 'none')
  icon.setAttribute('aria-hidden', 'true')
  icon.setAttribute('focusable', 'false')
  icon.replaceChildren(createMonitorGlyph())
  return icon
}

function createMonitorGlyph(): SVGPathElement {
  const path = document.createElementNS(SVG_NAMESPACE, 'path')
  path.setAttribute('fill', 'currentColor')
  path.setAttribute('fill-rule', 'evenodd')
  path.setAttribute('clip-rule', 'evenodd')
  path.setAttribute(
    'd',
    'M2.5 2.75A1.75 1.75 0 0 1 4.25 1h7.5A1.75 1.75 0 0 1 13.5 2.75v6.5A1.75 1.75 0 0 1 11.75 11H9.31l.47 1.5h1.47a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5h1.47L6.69 11H4.25A1.75 1.75 0 0 1 2.5 9.25v-6.5ZM4.25 2.5a.25.25 0 0 0-.25.25v6.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-6.5a.25.25 0 0 0-.25-.25h-7.5Z',
  )
  return path
}
