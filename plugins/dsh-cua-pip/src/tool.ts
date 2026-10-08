import { defineTool, type UserMessage } from '@just-genius/dsh-plugin-runtime/host'
import type { PipController } from './controller.ts'
import type { Frame } from './shared/types.ts'

export const COMPUTER_PIP = 'computer_pip'

export const PIP_GUIDANCE = `Picture in picture is an optional assistant-controlled companion for computer use.
computer_pip and computer_window are host tools: use these exact names without an MCP prefix.
Call the configured Cua tools directly for ordinary computer use. No computer_window bind,
computer_pip open/observe/control, unique PiP provider, or PiP recording permission is required.
Direct Cua calls, including run_code subcalls, retain their provider arguments and session lifecycle.
PiP does not impose background-only input, desktop declarations, or observation gates on them,
even while a preview is open, stale, stopped or unavailable. Follow the user's task constraints
and the provider's own permissions, approval requirements and coordinate contracts.
If computer_window bind fails with window_provider_unavailable, continue with the configured Cua
provider directly; binding is optional and that failure does not disable computer use.

Call computer_pip(action="open", app="application name or bundle id") when a live preview helps,
or pass pid and windowId from a fresh Cua result to monitor an existing window.
Ordinary computer-use calls do not open a preview. An open preview follows targeted windows and
remains alive between turns and while the user views another session.
PiP uses a native ScreenCaptureKit stream of exactly one window. DSH Window Capture needs its own
screen recording permission. Recording health and frame counts do not prove an action succeeded.
computer_pip(action="observe") delivers the actual native PiP image for optional verification;
preview pixels are not Cua action coordinates. Use the provider's fresh observations for direct input.
Direct inputs invalidate old PiP observations but never wait for PiP recording or image delivery.
Transient capture failures are retried at most twice. User-stopped sharing and permission refusals
are not automatically restarted. Report capture failure without blocking independent Cua work.

computer_window is an optional target-bound background workflow with stricter checks. Only its
nested Cua calls use host-owned driver sessions and guarded start_session preflights. Only its
act batches require a healthy recorder and the delivered observation for that exact target.
Do not reuse its targetId/observationId contract for raw Cua calls. Unsupported bound-window actions
can be performed directly through a capable Cua provider within the user's task authorization.
computer_pip(action="control", controlMode="desktop", pid, windowId, reason) remains available
for the PiP control workflow; it is not a prerequisite for direct Cua calls. This mode expires at
turn end/cancellation or after five minutes. Opening a preview resets it; closing only the preview
does not change it. Release it with controlMode="background" when no longer needed.

To resize the watched application window, call action="resize" with width and height. The default
resizeTarget="application" uses native OS logical units (points on macOS), preserves position and
does not request activation. This PiP-managed action retains its observation checks. Read the returned
windowBounds since applications may enforce size limits. resizeTarget="preview" adjusts only the
floating card in CSS pixels (minimum 64 per side). Both dimensions must be integers at most 16384.
Resize requires an open PiP and preserves its close deadline.
For a timed preview, pass closeAfterSeconds on open or call action="schedule_close". This host timer
closes only the preview; it never stops the application's timer, quits it or performs future input.
Use action="status" to inspect the preview and action="close" to close it. Respect user-closed previews.
Verify application results with fresh state. Do not repeat uncertain or destructive input merely to
improve a demonstration, and do not infer success from a successful click response or unchanged pixels.`

export function createPipTool(
  controller: PipController,
  saveObservation?: (frame: Frame, metadata: string) => Promise<UserMessage>,
) {
  return defineTool({
    name: COMPUTER_PIP,
    description: 'Explicitly open, resize, inspect, schedule closing, or close this session’s live application picture-in-picture. '
      + 'Use alongside Cua computer-use tools. Opening by app requests a background launch; '
      + 'opening by pid/windowId monitors an existing window. Resize defaults to the native app window; '
      + 'resizeTarget=preview changes only the floating card. Closing affects only the preview. '
      + 'Use observe after open and each application action to inspect the actual native PiP frame before further background input. '
      + 'Use control to declare temporary desktop fallback when background actions cannot work, or to return to background.',
    parameters: {
      action: { type: 'string', enum: ['open', 'observe', 'resize', 'status', 'schedule_close', 'close', 'control'], required: true },
      app: { type: 'string', description: 'Application name or bundle id, e.g. ima, Cursor, com.apple.clock. For open only.' },
      pid: { type: 'integer', description: 'Existing application pid for open or window-scoped desktop control. Omit for controlScope=desktop.' },
      windowId: { type: 'integer', description: 'Existing window id belonging to pid. Required for window-scoped desktop control; omit for controlScope=desktop.' },
      controlMode: {
        type: 'string', enum: ['background', 'desktop'],
        description: 'For control only: background (default posture) or temporary desktop fallback for an app requiring foreground input.',
      },
      controlScope: {
        type: 'string', enum: ['window', 'desktop'],
        description: 'For desktop control: window (default) requires pid/windowId; desktop handles menu-bar/system surfaces without window identifiers.',
      },
      reason: {
        type: 'string',
        description: 'For desktop control: required 1-1000 character explanation of the observed background limitation. Announce takeover to the user first.',
      },
      width: { type: 'integer', description: 'Required for resize. Native logical units by default; CSS pixels for resizeTarget=preview.' },
      height: { type: 'integer', description: 'Required for resize. Native logical units by default; CSS pixels for resizeTarget=preview.' },
      resizeTarget: {
        type: 'string', enum: ['application', 'preview'],
        description: 'For resize: application (default) changes the watched native window; preview changes only the floating card.',
      },
      closeAfterSeconds: {
        type: 'number',
        description: 'Close only the PiP after this many seconds (0 < value <= 86400); required for schedule_close.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          runtimeVersion: { type: 'string', required: true },
          sessionId: { type: 'string', required: true },
          open: { type: 'boolean', required: true },
          running: { type: 'boolean', required: true },
          target: {
            required: true,
            oneOf: [
              { type: 'null' },
              {
                type: 'object', additionalProperties: false,
                properties: { pid: { type: 'integer', required: true }, windowId: { type: 'integer', required: true } },
              },
            ],
          },
          closeAt: { oneOf: [{ type: 'null' }, { type: 'number' }], required: true },
          closedAt: {
            oneOf: [{ type: 'null' }, { type: 'number' }], required: true,
            description: 'Actual host close time in Unix milliseconds; null while open or before first close.',
          },
          lastFrameAt: { oneOf: [{ type: 'null' }, { type: 'number' }], required: true },
          frames: { type: 'integer', required: true },
          recording: {
            type: 'object', required: true, additionalProperties: false,
            properties: {
              state: { type: 'string', enum: ['closed', 'starting', 'ready', 'recovering', 'stale', 'suspended', 'stopped', 'failed'], required: true },
              ready: { type: 'boolean', required: true },
              generation: { type: 'integer', required: true },
              retryCount: { type: 'integer', required: true },
              nextRetryAt: { oneOf: [{ type: 'null' }, { type: 'number' }], required: true },
              errorCode: { oneOf: [{ type: 'null' }, { type: 'string' }], required: true },
            },
          },
          needsObservation: { type: 'boolean', required: true },
          observationDelivery: { type: 'string', enum: ['missing', 'queued', 'delivered'], required: true },
          observation: {
            required: true,
            oneOf: [
              { type: 'null' },
              {
                type: 'object', additionalProperties: false,
                properties: {
                  frameId: { type: 'string', required: true },
                  capturedAt: { type: 'number', required: true },
                  imageHash: { oneOf: [{ type: 'null' }, { type: 'string' }], required: true },
                  generation: { type: 'integer', required: true },
                  observedAt: { type: 'number', required: true },
                },
              },
            ],
          },
          error: { oneOf: [{ type: 'null' }, { type: 'string' }], required: true },
          windowBounds: {
            required: true,
            oneOf: [
              { type: 'null' },
              {
                type: 'object', additionalProperties: false,
                properties: {
                  x: { type: 'number', required: true }, y: { type: 'number', required: true },
                  width: { type: 'number', required: true }, height: { type: 'number', required: true },
                },
              },
            ],
          },
          previewSize: {
            required: true,
            oneOf: [
              { type: 'null' },
              {
                type: 'object', additionalProperties: false,
                properties: {
                  width: { type: 'integer', required: true }, height: { type: 'integer', required: true },
                },
              },
            ],
          },
          control: {
            type: 'object', required: true, additionalProperties: false,
            properties: {
              mode: { type: 'string', enum: ['background', 'desktop'], required: true },
              scope: { oneOf: [{ type: 'null' }, { type: 'string', enum: ['window', 'desktop'] }], required: true },
              target: {
                required: true,
                oneOf: [
                  { type: 'null' },
                  {
                    type: 'object', additionalProperties: false,
                    properties: { pid: { type: 'integer', required: true }, windowId: { type: 'integer', required: true } },
                  },
                ],
              },
              reason: { oneOf: [{ type: 'null' }, { type: 'string' }], required: true },
              expiresAt: { oneOf: [{ type: 'null' }, { type: 'number' }], required: true },
            },
          },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: (args.action !== 'control' ? '' : value.control.mode === 'desktop'
          ? 'Desktop fallback enabled for this session. Foreground input may now affect the user desktop; PiP remains single-window.\n'
          : 'Desktop fallback released. Computer Use is background-first again.\n') + JSON.stringify(value),
      }],
    },
    execute: async (args, exec) => {
      if (exec.agent === undefined) throw new Error('computer_pip requires a calling session')
      exec.signal.throwIfAborted()
      const sessionId = String(exec.agent.session.id)
      switch (args.action) {
        case 'open': return controller.open(sessionId, args, exec.signal)
        case 'observe': {
          const observation = await controller.monitor.observe(sessionId, exec.signal)
          if (observation === null) return controller.status(sessionId)
          if (saveObservation === undefined) throw new Error('PiP image delivery is unavailable; do not act without a usable observation')
          const metadata = JSON.stringify({
            source: 'screencapturekit-window', target: observation.target, ...observation.sample,
            width: observation.frame.width, height: observation.frame.height,
            coordinates: 'verification-only; not Cua pixel-action coordinates',
          })
          const context = await saveObservation(observation.frame, metadata)
          const image = context.content.find((part) => part.type === 'image')
          if (image === undefined) throw new Error('PiP observation must include an actual image attachment')
          exec.signal.throwIfAborted()
          exec.deferContext(context)
          controller.monitor.acknowledge(observation, { messageId: context.id, attachmentId: image.attachment.attachmentId })
          return controller.status(sessionId)
        }
        case 'control':
          if (args.controlMode === undefined) throw new Error('control requires controlMode')
          return controller.setControlMode(sessionId, { ...args, controlMode: args.controlMode }, exec.signal)
        case 'resize':
          if (args.width === undefined || args.height === undefined) throw new Error('resize requires width and height')
          return controller.resize(sessionId, {
            ...args, width: args.width, height: args.height,
          }, exec.signal)
        case 'schedule_close':
          if (args.closeAfterSeconds === undefined) throw new Error('schedule_close requires closeAfterSeconds')
          return controller.scheduleClose(sessionId, args.closeAfterSeconds)
        case 'close': return controller.close(sessionId)
        case 'status': return controller.status(sessionId)
        default: throw new Error('Unsupported computer_pip action')
      }
    },
  })
}
