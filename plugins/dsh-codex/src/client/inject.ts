import { CLIENT_SERVICES } from '@just-genius/dsh-plugin-runtime/client'

/** Cordis services required before the dsh-codex client may apply. */
export const CODEX_CLIENT_INJECT = [
  CLIENT_SERVICES.slots,
  CLIENT_SERVICES.locale,
  CLIENT_SERVICES.connection,
  CLIENT_SERVICES.remote,
  // Cordis guards nested services independently. Reading
  // `ctx.remote.session` requires this dotted name as well as its parent.
  CLIENT_SERVICES.remoteSession,
  // Per-session model directory: DSH 0.1.2 removed the `connection.api`
  // envelope RPCs (`sessions.models` / `selectModel`).
  CLIENT_SERVICES.modelDirectories,
  // Side Chat creates, previews, serializes, and releases draft attachments
  // through the 0.1.5 conversation controller.
  CLIENT_SERVICES.conversation,
  // Durable image reads, matching the main transcript.
  CLIENT_SERVICES.uiConversation,
  CLIENT_SERVICES.sessions,
  // DSH 0.1.5+ owns the right-Sidebar shell; this plugin contributes tab types.
  CLIENT_SERVICES.sidebarRight,
  CLIENT_SERVICES.sidebarRightTabs,
  // Terminal selections and file review comments register `@` codecs here.
  CLIENT_SERVICES.inputTriggers,
  CLIENT_SERVICES.settingsScope,
] as const
