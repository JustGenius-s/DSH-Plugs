import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') {
  console.log('Native macOS contract tests skipped on this platform.')
} else {
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  const temp = mkdtempSync(join(tmpdir(), 'dsh-capture-test-'))
  try {
    const binary = join(temp, 'capture-contract-tests')
    execFileSync('/usr/bin/xcrun', [
      'swiftc', '-swift-version', '5', '-parse-as-library',
      join(root, 'native', 'CaptureContract.swift'),
      join(root, 'test', 'native-capture-contract.swift'),
      '-o', binary,
    ], { stdio: 'inherit' })
    execFileSync(binary, [], { stdio: 'inherit' })
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}
