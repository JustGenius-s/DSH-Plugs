import { ASSETS_PATH } from './routes.ts'

export function sanitizeAssetPath(pathname: string, prefix = ASSETS_PATH): string | null {
  if (!pathname.startsWith(`${prefix}/`)) return null
  const rel = pathname.slice(prefix.length + 1)
  if (rel === '' || rel.includes('\0')) return null
  const segments = rel.split('/')
  for (const s of segments) {
    if (s === '' || s === '.' || s === '..' || s.includes('\\')) return null
  }
  return rel
}

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
}

export function contentTypeFor(rel: string): string {
  const dot = rel.lastIndexOf('.')
  const ext = dot === -1 ? '' : rel.slice(dot).toLowerCase()
  return MIME[ext] ?? 'application/octet-stream'
}
