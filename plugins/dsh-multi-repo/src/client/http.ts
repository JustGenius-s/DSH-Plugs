import type { HttpResult } from '../shared'

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    method: 'GET',
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  const value = await response.json() as HttpResult<T>
  if (!value.ok) throw new Error(value.message)
  return value.value
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const value = await response.json() as HttpResult<T>
  if (!value.ok) throw new Error(value.message)
  return value.value
}
