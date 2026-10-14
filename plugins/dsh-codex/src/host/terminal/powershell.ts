/** Install the same block protocol in both PowerShell 7 and Windows PowerShell 5.1. */
export function powerShellSetup(): string {
  return [
    "$env:TERM = 'xterm-256color'; $env:COLORTERM = 'truecolor'",
    '$global:OutputEncoding = [Console]::InputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
    "if (Get-Variable PSStyle -ErrorAction SilentlyContinue) { $PSStyle.OutputRendering = 'Ansi' }",
    'Import-Module PSReadLine -ErrorAction SilentlyContinue',
    // The browser owns line editing. Intercept console keys without echo so
    // ConPTY cannot replay a rendered transport expression after our OSC.
    'function global:PSConsoleHostReadLine {',
    '  $__dsh_line = New-Object Text.StringBuilder',
    '  while ($true) {',
    '    $__dsh_key = [Console]::ReadKey($true)',
    "    if ($__dsh_key.Key -eq 'Enter') { return $__dsh_line.ToString() }",
    "    if ($__dsh_key.Key -eq 'Backspace') { if ($__dsh_line.Length -gt 0) { $__dsh_line.Length-- }; continue }",
    '    if ([int]$__dsh_key.KeyChar -ge 32) { [void]$__dsh_line.Append($__dsh_key.KeyChar) }',
    '  }',
    '}',
    'function global:__dsh_run([string]$__dsh_encoded) {',
    '  $__dsh_source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($__dsh_encoded))',
    "  [Console]::Write(([char]27) + ']777;warp-block-start;' + [char]7)",
    '  $global:__dsh_exit = 0; $global:__dsh_success = $true; $global:__dsh_nativeExit = 0',
    '  try {',
    '    . ([ScriptBlock]::Create($__dsh_source + "`n" + \'$global:__dsh_success = $?; $global:__dsh_nativeExit = $LASTEXITCODE\'))',
    '    if (!$global:__dsh_success) { $global:__dsh_exit = 1; if ($global:__dsh_nativeExit) { $global:__dsh_exit = $global:__dsh_nativeExit } }',
    // Re-emitting an ErrorRecord in Windows PowerShell exposes the encoded
    // transport line as its invocation. Report the original error message.
    '  } catch { $global:__dsh_exit = 1; [Console]::Error.WriteLine($_.Exception.Message) }',
    '}',
    'function global:prompt {',
    '  $__dsh_promptSuccess = $?',
    '  if (!$__dsh_promptSuccess -and !$global:__dsh_exit) { $global:__dsh_exit = 1 }',
    "  [Console]::Write(([char]27) + ']777;warp-block-end;' + $global:__dsh_exit + ';' + $executionContext.SessionState.Path.CurrentFileSystemLocation.Path + [char]7)",
    "  $global:LASTEXITCODE = 0; $global:__dsh_exit = 0; ' '",
    '}',
    "$__dsh_node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1",
    "if ($__dsh_node) { $__dsh_version = & $__dsh_node.Source --version 2>$null; [Console]::Write(([char]27) + ']777;warp-node-version;' + $__dsh_version + [char]7) }",
    "[Console]::Write(([char]27) + ']777;warp-caps;bracketed-paste=0' + [char]7)",
    '$global:LASTEXITCODE = 0; $global:__dsh_exit = 0',
  ].join('\n')
}

export function powerShellArguments(): string[] {
  return ['-NoLogo', '-NoExit', '-EncodedCommand', Buffer.from(powerShellSetup(), 'utf16le').toString('base64')]
}

/** Dot-sourcing preserves shell variables, aliases and cwd across submissions. */
export function powerShellCommand(command: string): string {
  return `. __dsh_run '${Buffer.from(command, 'utf8').toString('base64')}'\r`
}
