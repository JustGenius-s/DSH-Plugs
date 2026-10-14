import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') {
  console.log('Native window capture is macOS-only; no desktop screenshot fallback is built.')
} else {
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  const app = join(root, 'lib', 'DSH Window Capture.app')
  const contents = join(app, 'Contents')
  const binary = join(contents, 'MacOS', 'dsh-window-capture')
  const inputs = ['native/CaptureContract.swift', 'native/WindowCapture.swift', 'native/Info.plist', 'scripts/build-native.mjs']
  const digest = createHash('sha256').update(process.arch)
  for (const file of inputs) digest.update(readFileSync(join(root, file)))
  const fingerprint = digest.digest('hex')
  const stamp = join(root, 'lib', 'native-capture.sha256')
  // Do not churn an ad-hoc identity (and its TCC grant) on every JS rebuild.
  if (existsSync(binary) && existsSync(stamp) && readFileSync(stamp, 'utf8') === fingerprint) {
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
    console.log('Native capture helper is unchanged.')
  } else {
    mkdirSync(join(contents, 'MacOS'), { recursive: true })
    execFileSync('/usr/bin/xcrun', [
      'swiftc', '-swift-version', '5', '-O', '-parse-as-library',
      '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos14.0`,
      join(root, inputs[0]), join(root, inputs[1]), '-o', binary,
    ], { stdio: 'inherit' })
    copyFileSync(join(root, 'native', 'Info.plist'), join(contents, 'Info.plist'))
    execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', app], { stdio: 'inherit' })
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
    writeFileSync(stamp, fingerprint)
    console.log(`Built ${app}`)
  }
}
