import { useEffect, useMemo, useState } from 'react'
import { buildPalette, type RenderTheme } from './cell-render'

const DARK: RenderTheme = {
  background: '#151517', foreground: '#e6e6e8', cursor: '#e6e6e8', selectionBackground: '#4176e6',
  palette16: ['#1e1e22', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#dcdfe4', '#5c6370', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#ffffff'],
}
const LIGHT: RenderTheme = {
  background: '#ffffff', foreground: '#3b3b3b', cursor: '#3b3b3b', selectionBackground: '#4176e6',
  palette16: ['#000000', '#cd3131', '#00bc00', '#949800', '#0451a5', '#bc05bc', '#0598bc', '#555555', '#666666', '#cd3131', '#14ce14', '#b5ba00', '#0451a5', '#bc05bc', '#0598bc', '#a5a5a5'],
}
const DARK_PALETTE = buildPalette(DARK.palette16)
const LIGHT_PALETTE = buildPalette(LIGHT.palette16)

export function useTerminalTheme() {
  const [dark, setDark] = useState(() => document.body.hasAttribute('data-ds-dark-theme'))
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.body.hasAttribute('data-ds-dark-theme')))
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    return () => observer.disconnect()
  }, [])
  const theme = useMemo(() => {
    const base = dark ? DARK : LIGHT
    const styles = getComputedStyle(document.body)
    const background = styles.getPropertyValue('--dsw-specific-sidebar-fill').trim()
    const foreground = styles.getPropertyValue('--dsw-alias-label-primary').trim()
    return {
      ...base,
      background: background || base.background,
      foreground: foreground || base.foreground,
      cursor: foreground || base.cursor,
    }
  }, [dark])
  return { theme, palette: dark ? DARK_PALETTE : LIGHT_PALETTE }
}

export function useCursorBlink(active: boolean, intervalMs = 530): boolean {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    if (!active) {
      setVisible(true)
      return
    }
    const timer = window.setInterval(() => setVisible(current => !current), intervalMs)
    return () => window.clearInterval(timer)
  }, [active, intervalMs])
  return visible
}
