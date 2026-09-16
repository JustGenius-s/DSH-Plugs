/** Local Vite / bundled apps may POST ingest from another localhost origin. */
export function isLocalOrigin(origin: string): boolean {
  if (origin === '') return false
  try {
    const url = new URL(origin)
    return url.hostname === 'localhost'
      || url.hostname === '127.0.0.1'
      || url.hostname === '[::1]'
      || url.hostname === '::1'
  } catch {
    return false
  }
}

export function corsHeaders(origin: string): Record<string, string> {
  if (!isLocalOrigin(origin)) return {}
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'Origin',
  }
}
