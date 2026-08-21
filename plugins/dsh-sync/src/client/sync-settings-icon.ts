const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const ICON_MARKER = 'data-dsh-sync-icon'

/**
 * Settings shell has no icon field on settings.section; unknown ids fall back
 * to the generic gear. Patch the nav button until the slot grows an icon API.
 */
export function installSyncSettingsIcon(getLabel: () => string): () => void {
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
      currentIcon.replaceWith(createSyncIcon(currentIcon))
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

function createSyncIcon(source: SVGElement): SVGElement {
  const icon = document.createElementNS(SVG_NAMESPACE, 'svg')
  for (const attribute of Array.from(source.attributes)) {
    icon.setAttribute(attribute.name, attribute.value)
  }
  icon.setAttribute(ICON_MARKER, 'true')
  icon.setAttribute('viewBox', '0 0 24 24')
  icon.setAttribute('fill', 'none')
  icon.setAttribute('stroke', 'currentColor')
  icon.setAttribute('stroke-width', '2')
  icon.setAttribute('stroke-linecap', 'round')
  icon.setAttribute('stroke-linejoin', 'round')
  icon.setAttribute('aria-hidden', 'true')
  icon.setAttribute('focusable', 'false')
  icon.replaceChildren(...createCloudUploadGlyph())
  return icon
}

/** Lucide cloud-upload (24×24 stroke paths). */
function createCloudUploadGlyph(): SVGPathElement[] {
  return [
    strokePath('M12 13v8'),
    strokePath('M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242'),
    strokePath('m8 17 4-4 4 4'),
  ]
}

function strokePath(d: string): SVGPathElement {
  const path = document.createElementNS(SVG_NAMESPACE, 'path')
  path.setAttribute('d', d)
  return path
}
