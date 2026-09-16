/** Strip foldable `// #region agent log` probe blocks from one source file. */
export function stripAgentLogRegions(source: string): string {
  return source.replace(
    /^[ \t]*\/\/[ \t]*#region agent log\r?\n[\s\S]*?^[ \t]*\/\/[ \t]*#endregion[ \t]*\r?\n?/gm,
    '',
  )
}
