/** Host terminal seam placeholder. */
export interface DashCodexTerminalServer {
  dispose(): void
}

export function createDashCodexTerminalServer(): DashCodexTerminalServer {
  return { dispose() {} }
}
