export interface JsonResult<T> {
  ok: boolean
  value?: T
  message?: string
  error?: string
  detail?: string
}

export async function requestJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    headers: { accept: 'application/json', ...init.headers },
    ...init,
  })
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new Error(`request failed (${response.status})`)
  }
  if (!response.ok) {
    const record = body !== null && typeof body === 'object' ? body as JsonResult<unknown> : undefined
    throw new Error(record?.message ?? record?.error ?? record?.detail ?? `request failed (${response.status})`)
  }
  return body as T
}

export function getJson<T>(path: string): Promise<T> {
  return requestJson<T>(path)
}

export function postJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Read the repository's conventional `{ ok, value | message }` envelope. */
export async function requestResult<T>(path: string, init: RequestInit = {}): Promise<T> {
  const result = await requestJson<JsonResult<T>>(path, init)
  if (!result.ok || result.value === undefined) {
    throw new Error(result.message ?? result.error ?? result.detail ?? 'request failed')
  }
  return result.value
}

export function getResult<T>(path: string): Promise<T> {
  return requestResult<T>(path)
}

export function postResult<T>(path: string, body: unknown): Promise<T> {
  return requestResult<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
