import { isAbsolute } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import { errorMessage, readJsonBody, sendJson as json } from '@just-genius/dsh-plugin-runtime/host'
import {
  CODEX_FILES_INFO_PATH,
  CODEX_FILES_REVEAL_PATH,
  type CodexFilesErr,
  type CodexFilesInfoResponse,
  type CodexFilesRevealRequest,
  type CodexFilesRevealResponse,
} from '../../shared/files'
import {
  hostPlatform,
  revealInFileManager,
  revealSupported,
  resolveWithinWorkspace,
  UnsupportedRevealError,
} from './reveal'

export interface DshCodexFilesServer {
  dispose(): void
}

/**
 * Host routes behind the files panel's row actions: what this host can do,
 * and a reveal that hands one workspace path to the native file manager.
 */
export function createDshCodexFilesServer(ctx: Context): DshCodexFilesServer {
  const disposeInfo = ctx.webServer.register({
    kind: 'exact',
    path: CODEX_FILES_INFO_PATH,
    handler: (req, res) => handleInfo(req, res),
  })
  const disposeReveal = ctx.webServer.register({
    kind: 'exact',
    path: CODEX_FILES_REVEAL_PATH,
    handler: (req, res) => handleReveal(ctx, req, res),
  })
  return {
    dispose() {
      disposeInfo()
      disposeReveal()
    },
  }
}

function handleInfo(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    json(res, 405, fail('bad-request', 'method not allowed'))
    return
  }
  const platform = hostPlatform()
  const value: CodexFilesInfoResponse = {
    ok: true,
    platform,
    revealSupported: revealSupported(platform),
  }
  json(res, 200, value)
}

async function handleReveal(ctx: Context, req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    json(res, 405, fail('bad-request', 'method not allowed'))
    return
  }
  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (error) {
    json(res, 400, fail('bad-request', errorMessage(error)))
    return
  }
  const request = parseReveal(body)
  if (request === undefined) {
    json(res, 400, fail('bad-request', 'invalid reveal request'))
    return
  }
  const absolute = resolveWithinWorkspace(request.cwd, request.path)
  if (absolute === undefined) {
    // Either a missing cwd or a path that escaped the workspace: the client
    // never sends those, so name it as a bad request rather than a failure.
    json(res, 400, fail('bad-request', 'path is outside the workspace'))
    return
  }
  try {
    await revealInFileManager(ctx, request.cwd, {
      absolutePath: absolute,
      directory: request.kind === 'dir',
    })
    const value: CodexFilesRevealResponse = { ok: true }
    json(res, 200, value)
  } catch (error) {
    if (error instanceof UnsupportedRevealError) {
      json(res, 200, fail('unsupported', errorMessage(error)))
      return
    }
    json(res, 200, fail('reveal', errorMessage(error)))
  }
}

function parseReveal(value: unknown): CodexFilesRevealRequest | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<CodexFilesRevealRequest>
  const cwd = candidate.cwd
  const path = candidate.path
  if (typeof cwd !== 'string' || !isAbsolute(cwd) || cwd.includes('\0')) return undefined
  if (typeof path !== 'string' || path.length === 0) return undefined
  if (candidate.kind !== 'file' && candidate.kind !== 'dir') return undefined
  return { cwd, path, kind: candidate.kind }
}

function fail(code: CodexFilesErr['code'], message: string): CodexFilesErr {
  return { ok: false, code, message }
}
