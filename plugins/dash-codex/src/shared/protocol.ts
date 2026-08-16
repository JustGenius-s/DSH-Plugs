export type TerminalClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; rows: number; cols: number }
  | { type: 'signal'; signal: 'interrupt' | 'terminate' }

export type TerminalServerMessage =
  | { type: 'ready'; cwd: string; shell: string; rows: number; cols: number }
  | { type: 'output'; text: string }
  | { type: 'context'; cwd: string; branch?: string }
  | { type: 'block-end'; exitCode: number }
  | { type: 'exit'; exitCode: number | null; signal: string | null }
  | { type: 'error'; message: string }
