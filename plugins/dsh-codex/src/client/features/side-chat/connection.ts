/**
 * Reading the shared RPC face.
 *
 * `ConnectionHandle.api` is REQUIRED, so a mounted connection always has one;
 * but the service may not be composed yet when a feature activates, and
 * touching `ctx.connection` on the Cordis proxy throws
 * `cannot get property "connection" without inject` when it is not declared.
 * Either failure used to leave the side-chat model picker with no api at all,
 * silently stuck on "模型…" — indistinguishable from a slow lookup.
 *
 * Pure and injectable so it can be tested without a client context.
 */

/** The slice of the connection service this module reads. */
export interface ApiBearingConnection {
  api: unknown
}

/**
 * Resolve the shared RPC client from a connection service object.
 *
 * @param connection - the `connection` service, or undefined when absent.
 * @returns the api face, or undefined when the service has not composed one.
 */
export function connectionApiOfConnection(
  connection: { api?: unknown } | undefined,
): unknown | undefined {
  return connection?.api
}

/**
 * Resolve the shared RPC client off a Cordis context.
 *
 * Reads through `ctx.get`, the accessor that never throws for an undeclared
 * service, then falls back to a plain property read for contexts that expose
 * the service directly. Both reads are guarded.
 */
/** The durable image reference carried by a session event. */
export interface DurableImageRef {
  readonly attachmentId?: string
  readonly name?: string
}

/**
 * The `ctx.uiConversation` image face.
 *
 * This is the API the MAIN transcript renders images through
 * (`loadImage` in the official chat view), so using it here is what makes a
 * side-chat image look and behave like a main-conversation image: one
 * session-authorized, cached read per attachment instead of a bespoke
 * fetch that could disagree with how the host serves the same bytes.
 */
export interface UiConversationFace {
  imageUrl(sessionId: never, attachment: DurableImageRef): Promise<string>
  peekImageUrl?(sessionId: never, attachment: DurableImageRef): string | undefined
}

/** Resolve the `uiConversation` image face off a Cordis context. */
export function uiConversationOf(ctx: object): UiConversationFace | undefined {
  let service: { imageUrl?: unknown } | undefined
  try {
    const getter = (ctx as { get?: unknown }).get
    if (typeof getter === 'function') service = (getter as (name: string) => unknown).call(ctx, 'uiConversation') as typeof service
    else service = (ctx as { uiConversation?: typeof service }).uiConversation
  } catch {
    service = undefined
  }
  if (service === null || typeof service !== 'object') return undefined
  if (typeof service.imageUrl !== 'function') return undefined
  return service as UiConversationFace
}

/**
 * Resolve the 0.1.2 Typert session remote (`ctx.remote.session`).
 *
 * Attachment reads moved there from the `connection.api` envelope, which no
 * longer carries a `sessions.*` namespace. Wrapped in the shape the transcript
 * expects so the image loader keeps one code path, and returned as undefined
 * when the namespace is not mounted — the caller falls back to the envelope.
 */
export function remoteSessionApiOf(ctx: object): { session: { attachment: unknown } } | undefined {
  let session: unknown
  try {
    const getter = (ctx as { get?: unknown }).get
    if (typeof getter === 'function') {
      const get = (getter as (name: string) => unknown).bind(ctx)
      // Cordis owns the namespace as a dotted service. Reading it directly is
      // both more precise and immune to a traceable `remote` carrier guarding
      // `.session`; the carrier fallback keeps older/simple contexts working.
      session = get('remote.session')
      if (session === undefined) {
        const remote = get('remote') as { session?: unknown } | undefined
        session = remote?.session
      }
    } else {
      session = (ctx as { remote?: { session?: unknown } }).remote?.session
    }
  } catch {
    session = undefined
  }
  if (session === null || typeof session !== 'object') return undefined
  if (typeof (session as { attachment?: unknown }).attachment !== 'function') return undefined
  return { session: session as { attachment: unknown } }
}

export function connectionApiOf(ctx: object): unknown | undefined {
  // Read through `ctx.get`, the accessor that never throws for an undeclared
  // service, then fall back to a plain property read for contexts that expose
  // the service directly. Both reads are guarded: Cordis's proxy throws
  // `cannot get property ... without inject` on an undeclared service, and it
  // carries no index signature, so the context is read structurally here.
  try {
    const getter = (ctx as { get?: unknown }).get
    if (typeof getter === 'function') {
      const handle = (getter as (name: string) => unknown).call(ctx, 'connection')
      const api = (handle as { api?: unknown } | undefined)?.api
      if (api !== undefined) return api
    }
  } catch {
    // An undeclared/unguarded service: fall through to the property read.
  }
  try {
    return (ctx as { connection?: { api?: unknown } }).connection?.api
  } catch {
    // A throwing proxy (undeclared service): there is simply no api yet.
    return undefined
  }
}

/**
 * Resolve one image block to a browser URL.
 *
 * `uiConversation.imageUrl` is preferred: it is the call the MAIN transcript
 * uses, so the side chat shows the same cached, session-authorized read as
 * the main conversation instead of a second fetch that can disagree with it.
 * The envelope/remote read is the fallback for a host without that face.
 */
export async function resolveImageUrl(input: {
  // The block's reference is loosely typed (`attachmentId?: unknown`) because
  // it arrives from session events, so the id is narrowed here rather than at
  // every call site.
  attachment: { attachmentId?: unknown; name?: unknown }
  sessionId: string
  api?: ImageApi | undefined
  uiConversation?: UiConversationFace | undefined
}): Promise<string> {
  const { sessionId, api, uiConversation } = input
  const attachmentId = input.attachment.attachmentId
  if (typeof attachmentId !== 'string' || attachmentId === '') {
    throw new Error('image block has no attachment id')
  }
  const attachment: DurableImageRef = typeof input.attachment.name === 'string'
    ? { attachmentId, name: input.attachment.name }
    : { attachmentId }
  if (uiConversation !== undefined) {
    // A cached URL is already displayable; skip the round-trip entirely.
    const peeked = uiConversation.peekImageUrl?.(sessionId as never, attachment)
    if (typeof peeked === 'string' && peeked !== '') return peeked
    return await uiConversation.imageUrl(sessionId as never, attachment)
  }
  if (api === undefined) throw new Error('no image transport is mounted')
  return await readAttachmentData(api, sessionId, attachmentId)
}

/**
 * One attachment read, normalized across both transports.
 *
 * DSH 0.1.2 moved session reads off the `connection.api` envelope onto Typert
 * remotes (`ctx.remote.session`). The two answer differently — the envelope
 * wrapped its payload in `{ result: { ok, value } }`, while the remote
 * resolves to the value and rejects on failure — so this adapts each to one
 * outcome rather than making callers know which transport they hold.
 */
export type ImageApi =
  | {
      sessions: {
        attachment(request: {
          sessionId: never
          attachmentId: never
        }): Promise<{ result: { ok: boolean; value?: { data?: string }; error?: { message?: string } } }>
      }
    }
  | {
      session: {
        attachment(request: {
          sessionId: never
          attachmentId: never
        }): Promise<{ data: string }>
      }
    }

/** Read one attachment's inline data URL through whichever face is mounted. */
export async function readAttachmentData(
  api: ImageApi,
  sessionId: string,
  attachmentId: string,
): Promise<string> {
  if ('session' in api) {
    const value = await api.session.attachment({
      sessionId: sessionId as never,
      attachmentId: attachmentId as never,
    })
    if (typeof value?.data !== 'string' || value.data === '') {
      // An empty payload is not a successful read: returning '' would set an
      // empty src on the <img> and render a broken image with no error state.
      throw new Error('attachment read returned no data')
    }
    return value.data
  }
  const response = await api.sessions.attachment({
    sessionId: sessionId as never,
    attachmentId: attachmentId as never,
  })
  const result = response.result
  if (!result.ok) throw new Error(result.error?.message ?? 'attachment read failed')
  const data = result.value?.data
  // Same rule as the remote path: a successful read with no bytes is a
  // failure, not an empty image.
  if (typeof data !== 'string' || data === '') throw new Error('attachment read returned no data')
  return data
}

/* ── draft attachments ──────────────────────────────────────────────────
 * Kept in the pure module so the chip/thumbnail logic and the paste filter
 * are testable without the CSS-importing component graph the composer pulls
 * in.
 */

/** Browser-owned draft attachment returned by DSH 0.1.5's conversation face. */
export interface SideChatDraftAttachment {
  readonly kind: 'image' | 'file'
  readonly id: unknown
  readonly file: File
  readonly previewUrl?: string
}

/** Wire attachment accepted by `SessionFace.prompt`. */
export type SideChatSubmitAttachment =
  | {
      readonly type: 'image'
      readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
      readonly data: string
      readonly name?: string
    }
  | {
      readonly type: 'file'
      readonly receiptId: string
    }

/**
 * Structural subset of DSH 0.1.5's `ConversationController` used by Side Chat.
 *
 * Kept on the shared adapter boundary instead of importing the platform
 * package from the plugin. This also avoids coupling to duplicated branded
 * `SessionId` / `DraftAttachmentId` copies in a materialized DSH runtime.
 */
export interface SideChatConversationFace {
  createDrafts(sessionId: string, files: readonly File[]): readonly SideChatDraftAttachment[]
  resolveDraftAttachments(ids: readonly unknown[]): readonly SideChatDraftAttachment[]
  serializeDraftAttachments(ids: readonly unknown[]): Promise<{
    readonly attachments: readonly SideChatSubmitAttachment[]
  }>
  releaseDraftAttachment(id: unknown): void
}

const DRAFT_ATTACHMENT_METHODS = [
  'createDrafts',
  'resolveDraftAttachments',
  'serializeDraftAttachments',
  'releaseDraftAttachment',
] as const

/** Validate an unknown service before a component can call attachment verbs. */
export function conversationAttachmentsOfService(
  service: unknown,
): SideChatConversationFace | undefined {
  if (service === null || (typeof service !== 'object' && typeof service !== 'function')) {
    return undefined
  }
  try {
    for (const method of DRAFT_ATTACHMENT_METHODS) {
      if (typeof (service as Record<string, unknown>)[method] !== 'function') return undefined
    }
  } catch {
    return undefined
  }
  return service as SideChatConversationFace
}

/** Resolve and validate the draft-attachment service off a Cordis context. */
export function conversationAttachmentsOf(ctx: object): SideChatConversationFace | undefined {
  let service: unknown
  try {
    const getter = (ctx as { get?: unknown }).get
    service = typeof getter === 'function'
      ? (getter as (name: string) => unknown).call(ctx, 'conversation')
      : (ctx as { conversation?: unknown }).conversation
  } catch {
    return undefined
  }
  return conversationAttachmentsOfService(service)
}

/** One draft attachment chip: what to render and which id to release. */
export interface DraftPreview {
  key: string
  id: unknown
  /** The draft's object URL, or undefined when the descriptor carries none. */
  url?: string
  name: string
}

/**
 * Resolve draft ids to the chips the composer renders.
 *
 * Read through `resolveDraftAttachments` because that is where the 0.1.5
 * service keeps the browser-owned preview URL; a chip built from the id alone
 * can only ever be a placeholder glyph.
 */
export function draftPreviewsOf(
  conversation: Pick<SideChatConversationFace, 'resolveDraftAttachments'> | undefined,
  ids: readonly unknown[],
): DraftPreview[] {
  const fallback = (): DraftPreview[] => ids.map((id, index) => ({
    key: String(id ?? index),
    id,
    name: '图片',
  }))
  if (ids.length === 0) return []
  if (conversation === undefined) return fallback()

  let descriptors: readonly SideChatDraftAttachment[]
  try {
    descriptors = conversation.resolveDraftAttachments(ids)
  } catch {
    // A runtime can replace a service while HMR is settling. A stale chip is
    // still removable; taking down the entire Side Chat is not useful.
    return fallback()
  }

  const descriptorById = new Map(descriptors.map(descriptor => [descriptor.id, descriptor]))
  return ids.map((id, index) => {
    const descriptor = descriptorById.get(id)
    if (descriptor === undefined) return { key: String(id ?? index), id, name: '图片' }
    const name = descriptor.file?.name ?? '图片'
    const url = typeof descriptor.previewUrl === 'string' && descriptor.previewUrl !== ''
      ? descriptor.previewUrl
      : undefined
    return {
      key: String(descriptor.id ?? id ?? index),
      id: descriptor.id ?? id,
      ...(url === undefined ? {} : { url }),
      name,
    }
  })
}

/** Build the ordered prompt payload using DSH's current attachment serializer. */
export async function sideChatPromptContent(
  conversation: Pick<SideChatConversationFace, 'serializeDraftAttachments'> | undefined,
  ids: readonly unknown[],
  text: string,
): Promise<unknown[]> {
  if (ids.length > 0 && conversation === undefined) {
    throw new Error('附件服务不可用')
  }
  const attachments = ids.length === 0
    ? []
    : [...(await conversation!.serializeDraftAttachments(ids)).attachments]
  return [
    ...attachments,
    ...(text.length === 0 ? [] : [{ type: 'text', text }]),
  ]
}

/**
 * The image files on a clipboard, if any.
 *
 * A paste may carry an image, text, or both; only images become attachments,
 * and a text-only paste must return empty so the textarea keeps its own
 * behaviour.
 */
export function imageFilesOf(clipboardData: DataTransfer | null): File[] {
  if (clipboardData === null) return []
  const files = Array.from(clipboardData.files ?? [])
  return files.filter(file => file.type.startsWith('image/'))
}
