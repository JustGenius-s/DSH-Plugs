import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'

const execFileAsync = promisify(execFile)
const GIT_TIMEOUT_MS = 15_000
const LLM_TIMEOUT_MS = 60_000
const MAX_BUFFER = 8 * 1024 * 1024
/** Diff budget fed to the model; longer diffs are truncated with a notice. */
const MAX_DIFF_CHARS = 12_000

const SYSTEM_PROMPT = [
  'You write git commit messages.',
  'Given a diff and recent commit subjects, output one concise commit message.',
  'Match the language and style of the recent subjects; use English when there are none.',
  'Output only the commit message itself: no explanations, no quotes, no markdown fences.',
].join(' ')

/**
 * Generate a commit message for the working tree of `cwd` with the harness's
 * default model. Staged changes are summarized when present, otherwise every
 * unstaged change plus the untracked file list (VSCode's "commit all" scope).
 */
export async function generateCommitMessage(ctx: Context, cwd: string): Promise<string> {
  const diff = await collectDiff(cwd)
  if (diff.length === 0) {
    throw badRequest('no changes to summarize')
  }
  const llm = ctx.get('llm')
  const defaultModel = ctx.get('agentDefaultModel')
  if (llm === undefined || defaultModel === undefined) {
    throw new Error('no model is configured')
  }
  const selection = defaultModel.currentSelection()
  const subjects = await recentSubjects(cwd)
  const prompt = [
    subjects.length === 0 ? '' : `Recent commit subjects:\n${subjects.join('\n')}\n`,
    `Diff:\n${diff}`,
  ].filter((part) => part.length > 0).join('\n')

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), LLM_TIMEOUT_MS)
  try {
    const stream = llm.stream({
      provider: selection.provider,
      model: selection.model,
      system: SYSTEM_PROMPT,
      messages: [createUserMessage({
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'user' },
      })],
      maxTokens: 1024,
      signal: abort.signal,
    })
    return await collectText(stream)
  } finally {
    clearTimeout(timer)
  }
}

/** Assemble the visible text of one model stream, surfacing failures. */
async function collectText(stream: AsyncIterable<StreamChunk>): Promise<string> {
  let text = ''
  for await (const chunk of stream) {
    if (chunk.type === 'block-end' && chunk.block.type === 'text') {
      text += chunk.block.text
    } else if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
      throw new Error(chunk.reason.failure.message)
    }
  }
  const message = text.trim().replace(/^```[a-z]*\n?|\n?```$/g, '').trim()
  if (message.length === 0) {
    throw new Error('the model returned an empty message')
  }
  return message
}

/** Staged diff when present, else the worktree diff plus untracked names. */
async function collectDiff(cwd: string): Promise<string> {
  const staged = await gitDiff(cwd, ['diff', '--cached', '--no-color', '--no-ext-diff'])
  if (staged.length > 0) return cap(staged)
  const parts: string[] = []
  const worktree = await gitDiff(cwd, ['diff', '--no-color', '--no-ext-diff'])
  if (worktree.length > 0) parts.push(worktree)
  const untracked = await gitDiff(cwd, ['ls-files', '--others', '--exclude-standard'])
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
async function recentSubjects(cwd: string): Promise<string[]> {
  const out = await gitDiff(cwd, ['log', '-5', '--format=%s'])
  return out.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
}

/** Run git, returning trimmed stdout; failures yield an empty string. */
async function gitDiff(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      encoding: 'utf8',
    })
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
