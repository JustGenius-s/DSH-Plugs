import type { DevicePollResult, DeviceStart } from './shared.ts'

const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const USER_URL = 'https://api.github.com/user'
const SCOPE = 'gist'

export async function startDeviceFlow(clientId: string): Promise<DeviceStart> {
  const id = clientId.trim()
  if (id === '') throw new Error('GitHub OAuth Client ID is required')

  const body = await postForm(DEVICE_CODE_URL, {
    client_id: id,
    scope: SCOPE,
  })

  if (typeof body.error === 'string') {
    throw new Error(formatOauthError(body))
  }

  const deviceCode = asString(body.device_code)
  const userCode = asString(body.user_code)
  const verificationUri = asString(body.verification_uri) || 'https://github.com/login/device'
  if (deviceCode === '' || userCode === '') {
    throw new Error('GitHub device flow response was incomplete')
  }

  return {
    userCode,
    verificationUri,
    verificationUriComplete: asString(body.verification_uri_complete) || null,
    deviceCode,
    interval: Math.max(1, Number(body.interval) || 5),
    expiresIn: Math.max(30, Number(body.expires_in) || 900),
  }
}

export async function pollDeviceFlow(
  clientId: string,
  deviceCode: string,
): Promise<DevicePollResult & { accessToken?: string }> {
  const id = clientId.trim()
  const code = deviceCode.trim()
  if (id === '' || code === '') {
    return { status: 'error', message: 'clientId and deviceCode are required' }
  }

  const body = await postForm(ACCESS_TOKEN_URL, {
    client_id: id,
    device_code: code,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  })

  if (typeof body.access_token === 'string' && body.access_token !== '') {
    return { status: 'success', login: '', accessToken: body.access_token }
  }

  const err = typeof body.error === 'string' ? body.error : ''
  if (err === 'authorization_pending') return { status: 'pending' }
  if (err === 'slow_down') {
    return { status: 'slow_down', interval: Math.max(1, Number(body.interval) || 10) }
  }
  if (err === 'access_denied') return { status: 'denied', message: 'Authorization was denied on GitHub.' }
  if (err === 'expired_token') return { status: 'expired', message: 'Device code expired; start login again.' }
  return { status: 'error', message: formatOauthError(body) }
}

export interface GithubUser {
  login: string
  avatarUrl: string
}

export async function fetchGithubUser(accessToken: string): Promise<GithubUser> {
  const response = await fetch(USER_URL, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${accessToken}`,
      'user-agent': 'dsh-sync',
      'x-github-api-version': '2022-11-28',
    },
  })
  if (!response.ok) {
    throw new Error(`GitHub user lookup failed (${response.status})`)
  }
  const json = await response.json() as { login?: unknown; avatar_url?: unknown }
  const login = typeof json.login === 'string' ? json.login : ''
  if (login === '') throw new Error('GitHub user login missing')
  const avatarUrl = typeof json.avatar_url === 'string' && json.avatar_url !== ''
    ? json.avatar_url
    : `https://github.com/${login}.png`
  return { login, avatarUrl }
}

async function postForm(url: string, fields: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'dsh-sync',
    },
    body: new URLSearchParams(fields).toString(),
  })
  let json: Record<string, unknown>
  try {
    json = await response.json() as Record<string, unknown>
  } catch {
    throw new Error(`GitHub OAuth request failed (${response.status})`)
  }
  if (!response.ok && typeof json.error !== 'string') {
    throw new Error(`GitHub OAuth request failed (${response.status})`)
  }
  return json
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function formatOauthError(body: Record<string, unknown>): string {
  const error = asString(body.error) || 'oauth_error'
  const description = asString(body.error_description)
  return description !== '' ? `${error}: ${description}` : error
}
