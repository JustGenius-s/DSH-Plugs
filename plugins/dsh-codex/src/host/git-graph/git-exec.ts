import type { Context } from '@just-genius/dsh-plugin-runtime/host'

export interface GitResult {
  stdout: string
  stderr: string
}

/** Raw outcome of one git process, without the exec-style throw on non-zero exit. */
export interface GitRunResult {
  stdout: string
  stderr: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
}

/** Raw-bytes outcome, for reading binary blobs (git show sha:path). */
export interface GitBufferResult {
  stdout: Buffer
  stderr: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
}

/** Pause between a killed git call and its single retry. */
const RETRY_DELAY_MS = 500
/** The retry gets a much longer budget: post-wake spawns are slow, not hung. */
const RETRY_TIMEOUT_FACTOR = 3
/** SIGTERM then grace then SIGKILL escalation window for a hung git process. */
const GRACE_MS = 2000

/** Thrown when a git call outlives its timeout and is killed by the seam. */
export class GitTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`git timed out after ${timeoutMs}ms`)
    this.name = 'GitTimeoutError'
  }
}

/**
 * Run git and return its captured output.
 *
 * Mirrors the previous execFile contract: a non-zero exit throws an error
 * carrying stderr/code so callers can branch on git's own message; a call
 * killed by its own timeout gets exactly one retry with a tripled budget.
 *
 * Right after the machine wakes from sleep the first git spawn regularly
 * outlives a tight timeout (cold disk caches, FileVault, network volumes);
 * failing the panel over that is noise, not an error.
 */
export async function execGit(
  ctx: Context,
  cwd: string,
  args: string[],
  timeout: number,
  maxBuffer: number,
): Promise<GitResult> {
  const first = await runGit(ctx, cwd, args, timeout, maxBuffer)
  if (!first.timedOut && first.exitCode !== 0) throw gitError(first)
  if (first.timedOut) {
    await delay(RETRY_DELAY_MS)
    const retry = await runGit(ctx, cwd, args, timeout * RETRY_TIMEOUT_FACTOR, maxBuffer)
    if (retry.exitCode !== 0) throw gitError(retry)
    return { stdout: retry.stdout, stderr: retry.stderr }
  }
  return { stdout: first.stdout, stderr: first.stderr }
}

/**
 * Run git and return the raw exit facts without throwing on a non-zero exit,
 * for callers that branch on the exit code (diff --quiet exits 1 on
 * differences, check-ignore exits 1 on no match).
 */
export async function runGit(
  ctx: Context,
  cwd: string,
  args: string[],
  timeout: number,
  maxBuffer: number,
): Promise<GitRunResult> {
  const spawned = await spawnGit(ctx, cwd, args, timeout, maxBuffer)
  return {
    stdout: spawned.stdout.toString('utf8'),
    stderr: spawned.stderr,
    exitCode: spawned.exitCode,
    signal: spawned.signal,
    timedOut: spawned.timedOut,
  }
}

/** Raw-bytes git run, for binary blob reads (git show sha:path). */
export async function runGitBuffer(
  ctx: Context,
  cwd: string,
  args: string[],
  timeout: number,
  maxBuffer: number,
): Promise<GitBufferResult> {
  return spawnGit(ctx, cwd, args, timeout, maxBuffer)
}

/** Run git writing one batch of bytes to stdin (e.g. check-ignore --stdin). */
export async function runGitWithStdin(
  ctx: Context,
  cwd: string,
  args: string[],
  stdinData: string,
  timeout: number,
  maxBuffer: number,
): Promise<GitRunResult> {
  const spawned = await spawnGit(ctx, cwd, args, timeout, maxBuffer, stdinData)
  return {
    stdout: spawned.stdout.toString('utf8'),
    stderr: spawned.stderr,
    exitCode: spawned.exitCode,
    signal: spawned.signal,
    timedOut: spawned.timedOut,
  }
}

interface SpawnedGit {
  stdout: Buffer
  stderr: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
}

async function spawnGit(
  ctx: Context,
  cwd: string,
  args: string[],
  timeout: number,
  maxBuffer: number,
  stdinData?: string,
): Promise<SpawnedGit> {
  const git = await ctx.subprocess.resolveExecutable('git')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  const handle = ctx.subprocess.spawn({
    argv: [git, ...args],
    cwd,
    stdio: {
      stdin: stdinData === undefined ? 'ignore' : { data: stdinData },
      stdout: 'pipe',
      stderr: 'pipe',
    },
    graceMs: GRACE_MS,
    signal: controller.signal,
  })
  try {
    const [stdout, stderr, outcome] = await Promise.all([
      readBuffer(handle.stdout, maxBuffer),
      readTextStream(handle.stderr, maxBuffer),
      handle.done,
    ])
    return {
      stdout,
      stderr,
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      timedOut: controller.signal.aborted,
    }
  } finally {
    clearTimeout(timer)
  }
}

function gitError(result: GitRunResult): Error & { stderr?: string; code?: number } {
  const stderr = result.stderr.trim()
  const reason = result.exitCode === null
    ? `signal ${result.signal ?? 'unknown'}`
    : `exit code ${result.exitCode}`
  // Carry git's own stderr as the message so upstream regexes ("not a git
  // repository", "unknown revision", etc.) keep matching the way execFile's
  // "Command failed: ...<stderr>" message did.
  const error = new Error(stderr.length > 0 ? stderr : `git ${reason}`) as Error & { stderr?: string; code?: number }
  error.stderr = result.stderr
  if (result.exitCode !== null) error.code = result.exitCode
  return error
}

async function readBuffer(stream: NodeJS.ReadableStream | undefined, maxBytes: number): Promise<Buffer> {
  if (stream === undefined) return Buffer.alloc(0)
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    total += buffer.length
    if (total > maxBytes) throw new Error(`git output exceeded ${maxBytes} bytes`)
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

async function readTextStream(stream: NodeJS.ReadableStream | undefined, maxBytes: number): Promise<string> {
  if (stream === undefined) return ''
  return (await readBuffer(stream, maxBytes)).toString('utf8')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
