export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: { accept: 'application/json', ...init?.headers },
  })
  return await response.json() as T
}
