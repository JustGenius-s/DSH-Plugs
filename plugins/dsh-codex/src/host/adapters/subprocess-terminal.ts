/**
 * The public subprocess handle currently omits PTY resize although the local
 * provider exposes it. Keep that version-specific shape at the host boundary.
 */
export function resizeSubprocessTerminal(handle: unknown, cols: number, rows: number): void {
  const terminal = (handle as {
    terminal?: { resize?: (columns: number, rows: number) => void }
  }).terminal
  terminal?.resize?.(cols, rows)
}
