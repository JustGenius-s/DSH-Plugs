import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Pause between a killed git call and its single retry. */
const RETRY_DELAY_MS = 500
/** The retry gets a much longer budget: post-wake spawns are slow, not hung. */
const RETRY_TIMEOUT_FACTOR = 3

export interface GitResult {
  stdout: string
  stderr: string
}

/**
 * Run git and return its captured output.
 *
 * A call killed by its own timeout gets exactly one retry with a tripled
 * timeout. Right after the machine wakes from sleep the first git spawn
 * regularly outlives a tight timeout (cold disk caches, FileVault, network
 * volumes); failing the panel over that is noise, not an error.
 */
export async function execGit(
  cwd: string,
  args: string[],
  timeout: number,
  maxBuffer: number,
): Promise<GitResult> {
  try {
    return await run(cwd, args, timeout, maxBuffer)
  } catch (error) {
    if (!isTimeoutKill(error)) throw error
    await delay(RETRY_DELAY_MS)
    return run(cwd, args, timeout * RETRY_TIMEOUT_FACTOR, maxBuffer)
  }
}

async function run(
  cwd: string,
  args: string[],
  timeout: number,
  maxBuffer: number,
): Promise<GitResult> {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd,
    timeout,
    maxBuffer,
    encoding: 'utf8',
  })
  return { stdout, stderr }
}

/** execFile marks a timeout kill as `killed: true` with a signal attached. */
function isTimeoutKill(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  const e = error as { killed?: unknown; signal?: unknown }
  return e.killed === true && typeof e.signal === 'string'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
