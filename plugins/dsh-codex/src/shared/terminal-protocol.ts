/** Wire protocol between the browser terminal view and the host PTY bridge. */

export type TerminalSignal = 'SIGINT' | 'SIGTERM' | 'SIGKILL' | 'SIGTSTP' | 'SIGHUP'

/** The Warp-style prompt context attached to each block (cwd, git, node, ...). */
export interface BlockContext {
  cwd: string
  nodeVersion?: string
  branch?: string
  files?: number
  adds?: number
  dels?: number
}

export interface TerminalCompletionCandidate {
  label: string
  replacement: string
  kind: 'command' | 'file' | 'directory' | 'flag' | 'subcommand' | 'variable' | 'history'
  description?: string
}

export type ServerMessage =
  | {
      type: 'ready'
      cwd: string
      shell: string
      rows: number
      cols: number
    }
  | { type: 'context'; context: BlockContext }
  | { type: 'output'; text: string }
  | {
      type: 'completion'
      requestId: number
      start: number
      end: number
      replacement: string
      candidates: TerminalCompletionCandidate[]
    }
  | { type: 'history'; commands: string[] }
  | { type: 'block-end'; exitCode: number }
  | { type: 'exit'; exitCode: number | null; signal: string | null }
  | { type: 'error'; message: string }

export type ClientMessage =
  | { type: 'input'; data: string }
  | { type: 'complete'; requestId: number; input: string; cursor: number }
  | { type: 'signal'; signal: TerminalSignal }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'kill' }
