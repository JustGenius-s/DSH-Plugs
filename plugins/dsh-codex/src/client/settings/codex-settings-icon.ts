const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const ICON_MARKER = 'data-dsh-codex-chatgpt-icon'

/**
 * The rc.6 settings shell chooses section icons from a private id switch and
 * exposes no icon field on settings.section. Keep this adapter local to Codex
 * until that slot contract grows an icon contribution.
 */
export function installCodexSettingsIcon(getLabel: () => string): () => void {
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
      const hasLabel = Array.from(button.querySelectorAll('span')).some(span => span.textContent?.trim() === label)
      if (!hasLabel) continue

      const currentIcon = button.querySelector<SVGElement>('svg')
      if (currentIcon === null || currentIcon.hasAttribute(ICON_MARKER)) continue

      if (!originals.has(button)) originals.set(button, currentIcon.cloneNode(true) as SVGElement)
      currentIcon.replaceWith(createChatGPTIcon(currentIcon))
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

function createChatGPTIcon(source: SVGElement): SVGElement {
  const icon = document.createElementNS(SVG_NAMESPACE, 'svg')
  for (const attribute of Array.from(source.attributes)) {
    icon.setAttribute(attribute.name, attribute.value)
  }
  icon.setAttribute(ICON_MARKER, 'true')
  icon.setAttribute('viewBox', '0 0 20 20')
  icon.setAttribute('fill', 'currentColor')
  icon.setAttribute('aria-hidden', 'true')
  icon.setAttribute('focusable', 'false')
  icon.replaceChildren(createCodexGlyph())
  return icon
}

function createCodexGlyph(): SVGGElement {
  const group = document.createElementNS(SVG_NAMESPACE, 'g')
  const codePath = document.createElementNS(SVG_NAMESPACE, 'path')
  codePath.setAttribute('d', 'M6.742 7.346a.665.665 0 0 1 .912.229l1.121 1.868c.206.343.206.77 0 1.113l-1.12 1.87a.666.666 0 0 1-1.141-.685L7.558 10 6.514 8.258a.665.665 0 0 1 .228-.912M13.334 11.418a.666.666 0 0 1 0 1.33h-2.5a.665.665 0 1 1 0-1.33z')
  const codexPath = document.createElementNS(SVG_NAMESPACE, 'path')
  codexPath.setAttribute('fill-rule', 'evenodd')
  codexPath.setAttribute('clip-rule', 'evenodd')
  codexPath.setAttribute('d', 'M7.798 1.781c1.532-.41 2.891.028 3.937.98 1.443-.288 3.164.104 4.283 1.222a4.49 4.49 0 0 1 1.22 4.077 4.485 4.485 0 0 1-1.94 7.239 4.484 4.484 0 0 1-7.237 1.939 4.485 4.485 0 0 1-5.3-5.299A4.486 4.486 0 0 1 4.7 4.7a4.49 4.49 0 0 1 3.097-2.918m3.254 2.168c-.79-.836-1.772-1.188-2.91-.884A3.16 3.16 0 0 0 5.885 5.39l-.095.398-.398.095a3.162 3.162 0 0 0-1.442 5.377l.298.282-.117.392a3.161 3.161 0 0 0 3.936 3.936l.393-.117.281.297a3.16 3.16 0 0 0 5.376-1.44l.095-.398.398-.095a3.162 3.162 0 0 0 1.442-5.377l-.298-.281.117-.393a3.16 3.16 0 0 0-.793-3.142c-.838-.839-2.256-1.122-3.352-.794l-.392.117z')
  group.append(codePath, codexPath)
  return group
}
