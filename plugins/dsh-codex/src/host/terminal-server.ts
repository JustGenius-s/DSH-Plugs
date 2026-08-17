/** Host terminal seam placeholder. */
export interface DshCodexTerminalServer {
  dispose(): void
}

export function createDshCodexTerminalServer(): DshCodexTerminalServer {
  return { dispose() {} }
}
