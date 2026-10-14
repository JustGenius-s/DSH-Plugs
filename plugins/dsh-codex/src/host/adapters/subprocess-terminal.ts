/**
 * The public subprocess handle currently omits PTY resize although the local
 * provider exposes it. Keep that version-specific shape at the host boundary.
 */
import type { SubprocessTerminalHandle, SubprocessTerminalSignal } from '@just-genius/dsh-plugin-runtime/host'

export function resizeSubprocessTerminal(handle: unknown, cols: number, rows: number): void {
  const terminal = (handle as {
    terminal?: { resize?: (columns: number, rows: number) => void }
  }).terminal
  terminal?.resize?.(cols, rows)
}

/** ConPTY delivers Ctrl+C as input; Windows does not have POSIX foreground groups. */
export async function signalSubprocessTerminal(
  handle: Pick<SubprocessTerminalHandle, 'write' | 'signalForeground'>,
  signal: SubprocessTerminalSignal,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform === 'win32' && signal === 'SIGINT') await handle.write('\x03')
  else await handle.signalForeground(signal)
}
