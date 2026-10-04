// Read-only check against the running host, not just the files on disk.
import { PIP_RUNTIME_VERSION, CONTROL_POLICY_VERSION } from '../src/shared/config.ts'
const base = process.argv[2]
if (!base) {
  console.error('Usage: node scripts/verify-live.mjs http://127.0.0.1:<DSH-host-port>')
  process.exitCode = 1
} else {
  const expected = PIP_RUNTIME_VERSION
  try {
    const response = await fetch(new URL('/cua-pip/health', base), { signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw new Error(`health returned ${response.status}; the running PiP plugin has not loaded this build`)
    const health = await response.json()
    if (health.runtimeVersion !== expected || health.transport !== 'sse'
      || health.capture !== 'screencapturekit-window' || health.resize !== true
      || health.nativeCapture?.built !== true || health.backgroundPolicy !== CONTROL_POLICY_VERSION
      || health.desktopFallback?.enabled !== true || health.desktopFallback?.scope !== 'session-and-window-or-desktop'
      || health.driverSessions?.scope !== 'dsh-session-and-provider'
      || health.driverSessions?.preflight !== 'start_session' || health.driverSessions?.replayInputs !== false
      || health.nativeCapture?.launch !== 'launchservices'
      || health.actionBindings !== 'canonical-session-provider-v2'
      || health.monitor?.readyGate !== true || health.monitor?.observe !== 'native-image'
      || health.monitor?.postActionObservation !== true
      || health.monitor?.modelRequestGate !== true
      || health.windowControl?.tool !== 'computer_window' || health.windowControl?.visualClick !== 'ax-hit-test-only'
      || health.windowControl?.maxBatchSteps !== 6 || health.windowControl?.rawPointer !== false
      || health.recovery?.maxRetries !== 2 || health.recovery?.restartUserStopped !== false) {
      throw new Error(`unexpected running capabilities: ${JSON.stringify(health)}`)
    }
    console.log(JSON.stringify(health, null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
