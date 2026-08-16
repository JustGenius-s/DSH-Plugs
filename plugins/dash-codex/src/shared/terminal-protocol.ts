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
  | { type: 'block-end'; exitCode: number }
  | { type: 'exit'; exitCode: number | null; signal: string | null }
  | { type: 'error'; message: string }

export type ClientMessage =
  | { type: 'input'; data: string }
  | { type: 'signal'; signal: TerminalSignal }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'kill' }
