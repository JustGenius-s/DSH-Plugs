import { GIST_DESCRIPTION, GIST_FILE } from './shared.ts'

const API = 'https://api.github.com'

export interface GistFileContent {
  id: string
  htmlUrl: string
  updatedAt: string
  content: string
}

export async function createSecretGist(accessToken: string, content: string): Promise<GistFileContent> {
  const json = await githubJson(accessToken, '/gists', {
    method: 'POST',
    body: {
      description: GIST_DESCRIPTION,
      public: false,
      files: {
        [GIST_FILE]: { content },
      },
    },
  })
  return parseGist(json)
}

export async function updateGist(
  accessToken: string,
  gistId: string,
  content: string,
): Promise<GistFileContent> {
  const json = await githubJson(accessToken, `/gists/${encodeURIComponent(gistId)}`, {
    method: 'PATCH',
    body: {
      description: GIST_DESCRIPTION,
      files: {
        [GIST_FILE]: { content },
      },
    },
  })
  return parseGist(json)
}

export async function getGist(accessToken: string, gistId: string): Promise<GistFileContent> {
  const json = await githubJson(accessToken, `/gists/${encodeURIComponent(gistId)}`, {
    method: 'GET',
  })
  return parseGist(json)
}

/** Prefer the stored gistId; otherwise find a secret gist with our description. */
export async function resolveGistId(
  accessToken: string,
  preferredId: string | null,
): Promise<string | null> {
  if (preferredId !== null && preferredId !== '') {
    try {
      await getGist(accessToken, preferredId)
      return preferredId
    } catch {
      // fall through to search
    }
  }

  const list = await githubJson(accessToken, '/gists?per_page=100', { method: 'GET' })
  if (!Array.isArray(list)) return null
  for (const item of list) {
    if (item === null || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (row.public === true) continue
    if (row.description !== GIST_DESCRIPTION) continue
    const id = typeof row.id === 'string' ? row.id : ''
    if (id === '') continue
    const files = row.files
    if (files === null || typeof files !== 'object') continue
    if (!(GIST_FILE in (files as Record<string, unknown>))) continue
    return id
  }
  return null
}

function parseGist(json: unknown): GistFileContent {
  if (json === null || typeof json !== 'object') {
    throw new Error('Invalid Gist response')
  }
  const row = json as Record<string, unknown>
  const id = typeof row.id === 'string' ? row.id : ''
  const htmlUrl = typeof row.html_url === 'string' ? row.html_url : ''
  const updatedAt = typeof row.updated_at === 'string' ? row.updated_at : new Date().toISOString()
  if (id === '') throw new Error('Gist id missing')

  const files = row.files
  if (files === null || typeof files !== 'object') {
    throw new Error(`Gist is missing ${GIST_FILE}`)
  }
  const file = (files as Record<string, unknown>)[GIST_FILE]
  if (file === null || typeof file !== 'object') {
    throw new Error(`Gist is missing ${GIST_FILE}`)
  }
  const content = typeof (file as Record<string, unknown>).content === 'string'
    ? (file as Record<string, unknown>).content as string
    : ''
  if (content === '') throw new Error(`${GIST_FILE} is empty`)

  return { id, htmlUrl, updatedAt, content }
}

async function githubJson(
  accessToken: string,
  path: string,
  init: { method: string; body?: unknown },
): Promise<unknown> {
  const response = await fetch(`${API}${path}`, {
    method: init.method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${accessToken}`,
      'user-agent': 'dsh-sync',
      'x-github-api-version': '2022-11-28',
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })

  let json: unknown = null
  const text = await response.text()
  if (text !== '') {
    try {
      json = JSON.parse(text) as unknown
    } catch {
      json = null
    }
  }

  if (!response.ok) {
    const message = extractMessage(json) || `GitHub API ${response.status}`
    throw new Error(message)
  }
  return json
}

function extractMessage(json: unknown): string {
  if (json === null || typeof json !== 'object') return ''
  const message = (json as Record<string, unknown>).message
  return typeof message === 'string' ? message : ''
}
