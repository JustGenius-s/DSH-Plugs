export const TERMINAL_TAB_KIND = 'dsh-codex-terminal'
export const TERMINAL_TAB_ID = '@just-genius/dsh-codex/terminal'

/** Identity shared by the controller registry, PTY reconnect token and close lifecycle. */
export function terminalControllerId(sessionId: string, tabId: string): string {
  return `${sessionId}:${tabId}`
}

export function terminalCwd(
  params: Readonly<Record<string, unknown>> | undefined,
  fallback: string | undefined,
): string | undefined {
  return typeof params?.cwd === 'string' && params.cwd.trim() !== ''
    ? params.cwd
    : fallback
}
