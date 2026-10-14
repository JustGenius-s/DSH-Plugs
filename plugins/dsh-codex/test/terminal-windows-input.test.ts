import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { completeTerminalInput } from '../src/host/terminal/completion'
import { historyFileCandidates, parseHistoryFile } from '../src/host/terminal/history'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

describe('PowerShell input helpers', () => {
  it('completes native commands and environment references without POSIX syntax', async () => {
    const env = { Path: '', USERPROFILE: 'C:\\Users\\demo' }
    const command = await completeTerminalInput('get-chil', 8, process.cwd(), env, 'powershell')
    expect(command.replacement).toBe('Get-ChildItem ')
    const variable = await completeTerminalInput('$env:userp', 10, process.cwd(), env, 'powershell')
    expect(variable.replacement).toBe('$env:USERPROFILE ')
  })

  it('quotes a directory containing spaces and apostrophes using PowerShell rules', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-terminal-completion-'))
    roots.push(root)
    await mkdir(join(root, "O'Brien 项目"))
    const command = 'Set-Location O'
    const result = await completeTerminalInput(command, command.length, root, { PATH: '' }, 'powershell')
    expect(result.candidates[0]?.replacement).toBe("'O''Brien 项目/")
  })

  it.skipIf(process.platform !== 'win32')('preserves drive prefixes and backslashes, including a partially quoted path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-terminal-path-'))
    roots.push(root)
    await mkdir(join(root, 'Folder With Space'))
    await writeFile(join(root, 'Folder With Space', '中文.txt'), 'fixture')
    const command = `Get-Content '${root}\\folder with space\\中`
    const result = await completeTerminalInput(command, command.length, root, { PATH: '' }, 'powershell')
    expect(result.candidates[0]?.replacement).toBe(`'${root}\\folder with space\\中文.txt' `)
  })

  it('uses PSReadLine history on Windows instead of HISTFILE or Bash history', () => {
    const files = historyFileCandidates('powershell.exe', 'C:/Users/demo', { APPDATA: 'C:/Roaming', HISTFILE: 'do-not-read' }, 'win32')
    expect(files).toEqual([join('C:/Roaming', 'Microsoft', 'Windows', 'PowerShell', 'PSReadLine', 'ConsoleHost_history.txt')])
  })

  it('joins PSReadLine multiline records and removes CRLF and transport history', () => {
    const text = "\uFEFFGet-Date\r\nWrite-Output `\r\n'中文'\r\n. __dsh_run 'dGVzdA=='\r\n"
    expect(parseHistoryFile('PSReadLine/ConsoleHost_history.txt', Buffer.from(text))).toEqual(['Get-Date', "Write-Output \n'中文'"])
  })
})
