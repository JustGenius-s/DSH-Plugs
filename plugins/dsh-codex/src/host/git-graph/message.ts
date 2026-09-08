import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import { createUserMessage, type StreamChunk } from '@just-genius/dsh-plugin-runtime/host'
import { execGit } from './git-exec'

const GIT_TIMEOUT_MS = 15_000
const MAX_BUFFER = 8 * 1024 * 1024
/** Diff budget fed to the model; longer diffs are truncated with a notice. */
const MAX_DIFF_CHARS = 12_000

/**
 * Response budget for one generate call, reasoning included.
 *
 * A reasoning model spends this on its thinking first: measured against
 * `hy4-dev`, a small diff burned ~3.9k characters of reasoning before writing
 * its first visible character, and only finished at 8k. A 1k budget therefore
 * always returned nothing — not because the model refused, but because it ran
 * out of room mid-thought.
 */
const LLM_MAX_TOKENS = 16_384
/**
 * Wall-clock budget for the whole generate call.
 *
 * Successful generations measured 54–83s on `hy4-dev`, so a 60s cap cancelled
 * a noticeable share of otherwise healthy calls — and the cancellation looked
 * like "nothing happened", since an aborted stream is treated as a quiet
 * client-side cancel.
 */
const LLM_TIMEOUT_MS = 180_000

/** Failure the caller turns into a visible, retryable message. */
export class CommitMessageFailure extends Error {
  constructor(message: string, readonly kind: 'truncated' | 'empty' | 'model') {
    super(message)
    this.name = 'CommitMessageFailure'
  }
}

const SYSTEM_PROMPT = [
  'You write git commit messages.',
  'Given a diff and recent commit subjects, output one concise commit message.',
  'Match the language and style of the recent subjects; use English when there are none.',
  'Output only the commit message itself: no explanations, no quotes, no markdown fences.',
].join(' ')

/**
 * Generate a commit message for the working tree of cwd with the harness's
 * default model. Staged changes are summarized when present, otherwise every
 * unstaged change plus the untracked file list (VSCode's "commit all" scope).
 *
 * signal lets the HTTP handler abort when the client disconnects (panel
 * switch / navigation) so a stuck stream does not keep the model busy.
 */
export async function generateCommitMessage(
  ctx: Context,
  cwd: string,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted === true) {
    throw new Error('aborted')
  }
  const diff = await collectDiff(ctx, cwd)
  if (diff.length === 0) {
    throw badRequest('no changes to summarize')
  }
  const llm = ctx.get('llm')
  const defaultModel = ctx.get('agentDefaultModel')
  if (llm === undefined || defaultModel === undefined) {
    throw new Error('no model is configured')
  }
  const selection = defaultModel.currentSelection()
  const subjects = await recentSubjects(ctx, cwd)
  const prompt = [
    subjects.length === 0 ? '' : `Recent commit subjects:\n${subjects.join('\n')}\n`,
    `Diff:\n${diff}`,
  ].filter((part) => part.length > 0).join('\n')

  const abort = new AbortController()
  const onOuterAbort = (): void => abort.abort()
  if (signal !== undefined) {
    if (signal.aborted) abort.abort()
    else signal.addEventListener('abort', onOuterAbort, { once: true })
  }
  // The caller's signal and this timer abort through one controller, so
  // distinguish them by cause: a client that wandered off must stay quiet,
  // while our own cap is a failure the user is waiting on and needs named.
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    abort.abort()
  }, LLM_TIMEOUT_MS)
  try {
    const stream = llm.stream({
      provider: selection.provider,
      model: selection.model,
      system: SYSTEM_PROMPT,
      messages: [createUserMessage({
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'user' },
      })],
      maxTokens: LLM_MAX_TOKENS,
      signal: abort.signal,
    })
    return await collectText(stream)
  } catch (error) {
    if (timedOut && isAbortFailure(error)) {
      throw new CommitMessageFailure(
        `the model did not finish within ${Math.round(LLM_TIMEOUT_MS / 1000)}s`,
        'model',
      )
    }
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onOuterAbort)
  }
}

/**
 * Assemble the visible text of one model stream, surfacing failures.
 *
 * A `max-tokens` finish is a budget failure, not an empty model answer: saying
 * otherwise sent every truncation down a dead end ("the model returned an
 * empty message") when the real fix was a larger budget. Reasoning text is
 * kept as a last resort because a thinking model's draft often already
 * contains the finished one-liner before the budget ran out.
 */
async function collectText(stream: AsyncIterable<StreamChunk>): Promise<string> {
  let text = ''
  let reasoning = ''
  let truncated = false
  for await (const chunk of stream) {
    if (chunk.type === 'block-end') {
      if (chunk.block.type === 'text') text += chunk.block.text
      else if (chunk.block.type === 'reasoning') reasoning += chunk.block.text
    } else if (chunk.type === 'finish') {
      const { kind } = chunk.reason
      if (kind === 'error' || kind === 'aborted') {
        throw new CommitMessageFailure(chunk.reason.failure.message, 'model')
      }
      if (kind === 'max-tokens') truncated = true
    }
  }
  const result = cleanMessage(text) ?? cleanMessage(reasoning)
  if (result === undefined) {
    throw new CommitMessageFailure(
      truncated
        ? 'the model ran out of room while thinking and wrote no commit message'
        : 'the model returned an empty message',
      truncated ? 'truncated' : 'empty',
    )
  }
  return result
}

/** Strip fences and surrounding noise; undefined when nothing usable remains. */
function cleanMessage(raw: string): string | undefined {
  const result = raw.trim().replace(/^```[a-z]*\n?|\n?```$/g, '').trim()
  return result.length === 0 ? undefined : result
}

/** Whether one thrown failure is our own abort surfacing through the stream. */
function isAbortFailure(error: unknown): boolean {
  if (error instanceof CommitMessageFailure) return false
  const text = error instanceof Error ? error.message : String(error)
  return /abort|cancel/i.test(text)
}

/** Staged diff when present, else the worktree diff plus untracked names. */
async function collectDiff(ctx: Context, cwd: string): Promise<string> {
  const staged = await gitDiff(ctx, cwd, ['diff', '--cached', '--no-color', '--no-ext-diff'])
  if (staged.length > 0) return cap(staged)
  const parts: string[] = []
  const worktree = await gitDiff(ctx, cwd, ['diff', '--no-color', '--no-ext-diff'])
  if (worktree.length > 0) parts.push(worktree)
  const untracked = await gitDiff(ctx, cwd, ['ls-files', '--others', '--exclude-standard'])
  if (untracked.length > 0) {
    parts.push(`Untracked files:\n${untracked}`)
  }
  return cap(parts.join('\n'))
}

function cap(diff: string): string {
  if (diff.length <= MAX_DIFF_CHARS) return diff
  return diff.slice(0, MAX_DIFF_CHARS) + '\n… (diff truncated)'
}

/** Recent commit subjects, for style matching; empty on an unborn HEAD. */
async function recentSubjects(ctx: Context, cwd: string): Promise<string[]> {
  const out = await gitDiff(ctx, cwd, ['log', '-5', '--format=%s'])
  return out.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
}

/** Run git, returning trimmed stdout; failures yield an empty string. */
async function gitDiff(ctx: Context, cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execGit(ctx, cwd, args, GIT_TIMEOUT_MS, MAX_BUFFER)
    return stdout.trim()
  } catch {
    return ''
  }
}

function badRequest(message: string): Error {
  const error = new Error(message)
  error.name = 'BadRequest'
  return error
}
