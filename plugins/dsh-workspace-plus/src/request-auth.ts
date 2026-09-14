export interface RequestAuthFace {
  requestRejection?: (request: { headers: unknown }) => 401 | 403 | undefined
}

/** Fail closed when the current DSH browser-auth capability is unavailable. */
export function requestRejection(
  connection: RequestAuthFace | undefined,
  request: { headers: unknown },
): 401 | 403 | undefined {
  if (typeof connection?.requestRejection !== 'function') return 401
  try {
    const status = connection.requestRejection(request)
    return status === undefined || status === 401 || status === 403 ? status : 401
  } catch {
    return 401
  }
}
