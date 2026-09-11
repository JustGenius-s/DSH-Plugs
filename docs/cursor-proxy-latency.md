# Why the DSH Cursor proxy feels slower than native Cursor or OpenRouter

Date: 2026-08-25  
Question: Why does `dsh-tencent` / `@tencent/dsh-tencent` feel slow compared with the Cursor IDE or an OpenRouter chat-completions route?

Primary sources only. Constants below are literals in source. Session deltas are `time` field subtraction from named jsonl events. No invented timings.

Related: `docs/cursor-vs-openrouter-cache-rate.md` (cache-hit display vs this hop-path latency note).

## Local Source Update: 2026-09-10

Sections 1-7 below preserve the **2026-08-25 investigation baseline**, not the current implementation or proof of the currently loaded DSH host version.

The current source at `/Users/jiahaoqian/proj/dsh-tencent` now has a bounded HTTP/2 connection pool, verified catalog caching/direct wire-ID paths, held-run resume without prompt/image/catalog preparation, ordered SSE backpressure handling, and a shared request deadline.

The retry increment limits duplicate Runs after failure:

- Any upstream response-body bytes, including an incomplete frame or heartbeat, conservatively block automatic replay. Before any bytes, transient transport/idle failures may retry once only if output, tool calls, tool writes, checkpoint and deadline guards also permit it.
- First byte, first parsed JSON-object frame, first thinking and first text are distinct diagnostics. None of the transport markers proves that the upstream operation succeeded.
- Heartbeats do not refresh the useful-progress timeout. This change does not shorten the initial idle wait or convert errors into successful answers.
- A failed or replaced request discards its unfinished checkpoint. Cleanup checks request ownership so a late failure cannot delete the replacement's session.
- DSH's outer retry policy is unchanged. A lower proxy retry count alone is not evidence of lower end-to-end latency or a better success rate.

The subsequent tool-dispatch increment adds monotonic collection/quiet-window, HTTP handoff, and per-resume progress/text timings. Resumed steps now have their own request correlation and first-output markers. Timing metadata stays internal; diagnostics remain opt-in. The 300ms quiet window is unchanged: locally inspected Cursor execution-completion events do not establish a reliable pre-execution batch boundary. No speculative early-dispatch path was enabled. New regression tests cover late/duplicate/multiple/split tool notifications, completion signals and response-listener cleanup. This is instrumentation and regression protection, not a demonstrated speedup.

Only loopback HTTP/HTTP2 fixtures were exercised during implementation. On 2026-09-10 the user separately authorized a Desktop restart with diagnostic logging. After a Desktop crash left an orphaned host holding port 18765, the identified idle orphan was stopped and Desktop was relaunched. At 02:40:39 Asia/Shanghai, one Desktop-owned host was listening on 18765 with `DSH_CURSOR_TRACE=1`, zero active/total proxy requests, and the profile resolving to that build. The Desktop crash root cause remains unresolved. User-initiated conversations were subsequently observed: the fixed 02:48:47-02:53:25 window contained 26 HTTP requests, 20 fast-path tool resumes, no proxy retry decisions, and one 409 after a late tool notification triggered Run closure. That sample exposed a correctness issue, not a successful full-conversation result. See `cursor-proxy-live-validation-2026-09-10.md` for measured timings and limitations.

The latest increment implements bounded late-tool continuation. Offered tool IDs/arguments remain immutable; matching call IDs or nonempty exec IDs deduplicate paused notifications. New late tools enter the next HTTP turn on the same upstream Run after the previous complete result set finishes local writing, including HTTP/2 backpressure. Queued tools reuse elapsed quiet time without changing the 300ms constant. Paused text/thinking is buffered for the resumed response. Limits are 64 queued tools, 512 output chunks and a shared 1MiB payload budget; overflow, cancellation, replacement and paused expiry clean up rather than replay. Local buffered output does not count as new upstream progress; a buffered first text can still appear immediately after resume, so correlate `first_text_after_resume` with `deferred_output_replayed` when interpreting latency.

The expected benefit is fewer interrupted tool conversations and no second full quiet-window wait for already-aged queued tools, not faster upstream inference. Full offline regression passed 110/110 twice, plus typecheck and build. At 03:46:18 Asia/Shanghai Desktop was restarted after verifying the old host idle. At 03:50:53 its single directly-owned host was listening on 18765, tracing enabled, zero active/total proxy requests, and profile resolution/build hash/post-build start time matched the new bundle. The fix has not yet been measured with a new real conversation, cannot revive an already-closed Run, and does not eliminate every possible 409. No real Cursor/cursoride2api A/B was run. Current test results and runtime evidence are in `dsh-tencent-implementation-report.md`; historical timings below must not be presented as measurements of this build.

## 1. Exact hop path

**DSH LLM (OpenAI chat completions) → local dsh-proxy → Cursor Agent `Run`.**

This is not Cursor’s native IDE client. DSH talks to a loopback OpenAI facade; the plugin opens a Connect-RPC Agent stream to Cursor.

| Hop | Evidence |
| --- | --- |
| DSH provider `cursor` | `~/.dsh/settings.yaml` `llm-pi-ai.providers.cursor`: `api: openai-completions`, `baseURL: http://127.0.0.1:18765/dsh-proxy/v1` |
| Default model | same file: `agent-default-model.provider: cursor`, `model: cursor-grok-4.6-fast` |
| Default effort (DSH, not the proxy) | `dsh-model-custom-ex.defaults.cursor.cursor-grok-4.6-fast: xhigh` |
| Host listen | `src/types.ts` `DEFAULT_CONFIG.entry` `{ host: '127.0.0.1', port: 18765 }`; live `~/.dsh/storages/dsh-proxy/config.json` `entry.port: 18765` |
| Route prefix | `src/types.ts` `PROXY_PREFIX = '/dsh-proxy'`, `CURSOR_V1_PREFIX = '/dsh-proxy/v1'` |
| Dispatch | `src/index.ts` `handleProxy` → `handleCursor` when path starts with `CURSOR_V1_PREFIX` |
| Chat facade | `src/routes/cursor.ts` `handleCursor`: only `GET /models` and `POST /chat/completions` under that prefix |
| Upstream | `handleCursor` → `chat()` / `HeldCursorRun.start` (`src/cursor/client.ts`) |
| Cursor wire | `HeldCursorRun.begin`: `connect(options.baseUrl)` then `this.client.request(..., ':path': '/agent.v1.AgentService/Run')`. Default `baseUrl` `https://api2.cursor.sh` (`src/types.ts` `DEFAULT_CONFIG.cursor.baseUrl`; same in live `config.json`) |
| Connect-RPC | `headers()` sets `content-type: application/connect+json`, `connect-protocol-version: 1` |
| First frame | `writeFrame({ runRequest })` with `conversationState`, `userMessageAction`, `modelDetails`, optional `mcpTools` |

Plugin README (`dsh-tencent/README.md` and `~/.dsh/profiles/web/node_modules/@tencent/dsh-tencent/README.md`) documents the same Cursor Base URL and that `/dsh-proxy/v1/chat/completions` is “Cursor Agent API in OpenAI Chat Completions format.”

DSH’s completions client (`@earendil-works/pi-ai` `createClient` / `buildParams` in `openai-completions.js`) always sends `stream: true` plus a structured `messages` array. The proxy then **flattens** that array into a Cursor `userMessage.text` (`requestPrompt` / `messagesToPrompt`).

### Tool loop (MCP through DSH, then resume or new Run)

1. Cursor `execServerMessage` / MCP args → `HeldCursorRun.rememberMcpCall` → after **300 ms** `settle()` pauses the HTTP/2 run (`phase = 'paused'`, stored in `heldRuns`).
2. Proxy returns OpenAI `finish_reason: 'tool_calls'` (`handleCursor` + `toOpenAiToolCalls`).
3. DSH executes tools locally (outside the proxy).
4. New `POST /chat/completions` with trailing `role: tool`. `findHeldRun` + `HeldCursorRun.resume` writes `mcpResult` frames on the **same** stream (`resume` / `mcpResultFrame`).
5. If no held run (or idle-timeout catch): new `chat()` / new `Run`. `requestPrompt(..., 'full')` / `messagesToPrompt` flatten. Idle path: `handleCursor` catch → `forgetConversationState` → `chat(..., conversationState: {})`.

Lane mapping: `src/cursor/lane.ts` `conversationLane` / `conversationIdFromLane`. Non-tool turns call `abandonHeldRuns(lane)`.

```
DSH (pi-ai openai-completions, stream=true)
  → http://127.0.0.1:18765/dsh-proxy/v1/chat/completions
  → handleProxy / handleCursor
  → HeldCursorRun.begin
      http2.connect(https://api2.cursor.sh)
      POST /agent.v1.AgentService/Run
  → (tool_calls) DSH tools → POST again → resume same stream
     or new Run after idle / lost hold
```

`detectCompat` in `openai-completions.js` sets `sendSessionAffinityHeaders: false` unless `model.compat` overrides it. Cursor’s provider is not OpenRouter, so pi-ai does **not** automatically send `x-session-id`. The proxy still builds a lane from `x-session-id` / body session fields, else a hash of first system+user (`conversationLane`).

## 2. Proxy behaviors that add latency **by design**

These are adapter choices in `dsh-tencent`, not unexplained bugs.

| Behavior | Where | What it costs |
| --- | --- | --- |
| **New HTTP/2 session per Run / catalog fetch** | `HeldCursorRun.begin`: `this.client = connect(options.baseUrl)`; `getModels`: `client = connect(options.baseUrl)`; `close()` `client?.close()`. No shared `http2` agent / pool in `src/cursor/client.ts`. | TLS + HTTP/2 setup to `api2.cursor.sh` on every new Run and every catalog miss. |
| **GetUsableModels before every completion** | `handleCursor` `catalog = await usableModels(...)`. `usableModels` in `src/routes/cursor.ts`. `getModels` path `/agent.v1.AgentService/GetUsableModels`. | Extra Connect-RPC **on cache miss**. Cache is **10 minutes** (`modelCache` `10 * 60 * 1000`). Cache hit is in-process only (still `await`ed, no extra hop). Timeout cap `Math.min(requestTimeout, 15_000)`. |
| **Full prompt flatten** | `src/cursor/converter.ts` `messagesToPrompt`, `requestPrompt`. Mode `full` if no `peekConversationState`; `delta` = last user text. Tool tails **always** full flatten. Idle retry forces `messagesToPrompt(messages)` + empty `conversationState`. | Large prompt re-sent; Cursor must re-ingest. `conversationState` TTL **30 min** (`src/cursor/usage.ts` `CONVERSATION_STATE_TTL_MS`). |
| **90s stall → fail → full retry** | `STALL_MS = 90_000`. Heartbeat 5s: if `running` and `Date.now() - lastUsefulAt >= stallMs` → `IDLE_TIMEOUT` (`'Cursor idle timeout'`). `stallMs = Math.min(STALL_MS, Math.max(30_000, options.requestTimeout))`. Live `requestTimeout: 120000` → stall **90s**. Catch in `handleCursor`: thinking SSE `上游长时间无输出，正在重试…` then **new** `chat()` + full flatten. | Adds a full second Run after 90s of no useful frames (heartbeat writes do **not** call `touchUseful`; `onData` does). |
| **300ms tool flush** | `rememberMcpCall`: `setTimeout(() => this.settle(), 300)` | Batches multiple MCP calls; adds 300ms after the last one before OpenAI `tool_calls` is returned. |
| **Catalog resolve on the hot path** | `resolveCursorModel` / `groupCursorModels` (`src/cursor/catalog.ts`) after `usableModels` | CPU only after cache; network only on miss. Required because Cursor rejects grouped ids like `cursor-grok-4.6-fast` (comment in `resolveCursorModel`). |
| **No connection pool** | Only `node:http2` `connect()` per operation | Same as first row. |
| **MCP / tool round-trip through DSH** | Facade returns `tool_calls`; DSH runs tools; next POST `resume` or new `Run` | Extra local HTTP + possible new `Run` if held session lost (`HELD_TTL_MS = 5 * 60_000`). |
| **SSE keep-alive (not upstream)** | `handleCursor` interval 10s: if no yield for 10s, `buildThinkingChunk('正在等待模型…')` then `\u200b` | Visible “wait” text; does **not** call Cursor. |
| **HTTP request timeout** | `request.setTimeout(this.requestTimeout)` default **120000** (`src/types.ts` `DEFAULT_CONFIG.cursor.requestTimeout`; live config same) | Hard fail, then same retry catch (`上游中断，正在重试…` if not idle). |
| **Remote image fetch (conditional)** | `extractCursorImages` / `fetchImage` 15s abort | Only if message parts are `https?` image URLs. |

`src/http.ts` is loopback/JSON helpers only; it does not talk to Cursor. `src/runtime.ts` `ProxyRuntime.begin` counts requests; it does not record TTFT.

`dsh-tencent/README.md`: “Idle upstream (90s without useful bytes) retries once on that request only.”

## 3. What is **not** the proxy

These sit **after** `connect('https://api2.cursor.sh')` or **before** the proxy (DSH / model product):

- **Cursor thinking / reasoning stream**: `interactionUpdate.thinkingDelta` → `applyThinkingDelta` → `onThinking`. Duration field `thinkingCompleted.thinkingDurationMs` stored as `thinkingMs` (`HeldCursorRun.onMessage`).
- **DSH reasoning effort `xhigh`**: `settings.yaml` `dsh-model-custom-ex.defaults.cursor.cursor-grok-4.6-fast: xhigh` → `requestReasoningEffort` → `resolveCursorModel` → wire id like `cursor-grok-4.6-xhigh-fast`.
- **Model queue / capacity on Cursor**: not implemented in this repo; wait appears as silence until `textDelta` / `thinkingDelta` / `onData`.
- **Network / TLS / HTTP/2 to `api2.cursor.sh`**: after `connect(baseUrl)`. The proxy does not implement a queue or thinking engine.
- **DSH local tool execution time**: between `tool_calls` response and the next `POST` (outside `HeldCursorRun`).
- **OpenRouter comparison baseline**: OpenRouter is a native chat-completions hop (`settings.yaml` `llm-pi-ai.providers.openrouter`). It does not flatten into Agent `Run`, does not open HTTP/2 to `api2.cursor.sh`, and does not hold/resume MCP exec frames.

## 4. Architecture: protocol mismatch, not “badly designed”

**OpenAI stateless `chat/completions` + DSH tool loop, over Cursor stateful Agent `Run`.**

- DSH config: `api: openai-completions` (`settings.yaml`).
- Cursor: Connect-RPC `AgentService/Run` with `conversationState`, exec/MCP on one long stream (`HeldCursorRun`).
- Adapter work: flatten transcript (`messagesToPrompt`), hold/resume runs, map MCP ↔ OpenAI tools, catalog id rewrite, idle-timeout **re-bootstrap**.

That is an impedance-matching facade. Costs (new `connect`, flatten, 90s then new Run, 300ms flush, catalog RPC) are **intentional adapter choices**. They amplify Cursor-side think/queue time; they do not generate thinking tokens.

| Native Cursor | This proxy | OpenRouter in DSH |
| --- | --- | --- |
| One Agent `Run` for the chat | One `Run` per DSH completion unless `findHeldRun` resumes | One chat-completions request per DSH step |
| Structured conversation + blobs | Flattened `userMessage.text`; `conversationState` only if checkpoint remembered | Structured `messages` array (prefix cache friendly) |
| Tools inside the Agent | Tools often round-trip through DSH, then resume or a new Run | Tools stay in DSH; provider only sees OpenAI tool calls |
| HTTP/2 session reused in-product | `connect()` per `begin()` and per `getModels()` | Provider HTTP client reuse (not this plugin) |

The **transport** (loopback OpenAI SSE) is not the bottleneck. The **fit** is poor. Installed package `~/.dsh/profiles/web/node_modules/@tencent/dsh-tencent/lib/index.js` matches these behaviors (`IDLE_TIMEOUT`, `GetUsableModels`, retry SSE).

## 5. Session-log evidence (idle retry + long wait)

Do not treat investigation tool dumps as retries. Real proxy SSE is `assistant/chunk` text exactly `正在等待模型…` (10s keep-alive) or `\n上游长时间无输出，正在重试…` (idle catch in `handleCursor`).

**File:** `/Users/jiahaoqian/.dsh/sessions/--Users-jiahaoqian-proj-DSH-Plugs--/session-95fd29ee-9017-4757-8ff2-942824a29e73/session.jsonl.zstd`

Counts in that file: **24** `assistant/chunk` bodies containing `上游长时间无输出，正在重试…`; **11** distinct `(turn,step)` pairs; **29** exact `正在等待模型…` chunks. Provider on `request/header`: `cursor` / `cursor-grok-4.6-fast` with `reasoningEffort: xhigh`.

**Turn 1 / step 6 (idle stall matches `STALL_MS`):**

```
{"type":"step/start","seq":110,"time":1787410457600,"data":{"turn":1,"step":6}}
{"type":"assistant/chunk","seq":112,"time":1787410467609,...,"text":"正在等待模型…"}
{"type":"assistant/chunk","seq":121,"time":1787410547676,...,"text":"\n上游长时间无输出，正在重试…"}
```

Deltas from `step/start` `1787410457600`: keep-alive **10009 ms** (~10s interval in `handleCursor`); idle-retry SSE **90076 ms** (~`STALL_MS` 90_000). Next real `text-delta` at `1787410559002` → **101402 ms** after step start.

**Turn 1 / step 14:** `step/start` `1787410609687` → retry SSE `1787410700354` = **90667 ms**.

Keep-alives (`\u200b` after the first wait) are **not** Cursor tokens; they are local SSE.

**TRANSPORT retries (DSH layer, not the 90s stall):** same session has `llm/retry` with `failure.code: "TRANSPORT"` and `message: "terminated"` (example seq 259, time `1787410599811`). That is DSH `dsh-llm-retry` recovering a dropped stream; it is separate from `IDLE_TIMEOUT`. The session also logged **106** `llm/retry` + `llm/retry-started` events (policy includes `TIMEOUT` / `TRANSPORT`).

**Other cursor sessions (step/start → first `assistant/chunk`; first chunk can be keep-alive, so this is not pure model TTFT):**

| Session | n | min ms | med ms | p90 ms | max ms |
| --- | --- | --- | --- | --- | --- |
| `…/session-51ae1fa6-6ee3-4cf5-a30a-87b58f429c94` | 616 | 30 | 2730 | 14745 | 62479 |
| `…/session-c0272aae-3f07-4d7a-8fc7-ea3908ceab3b` | 176 | 26 | 1985 | 8161 | 36383 |
| `session-95fd29ee-…` (above) | 269 | 312 | 1762 | 10009 | 31713 |

Median first-chunk wait of **1.7–2.7 s** is incompatible with “localhost proxy is intrinsically slow.” The long tail is Cursor think/queue plus the 90s idle → new Run path.

`session-51ae1fa6` usage samples: model `cursor-grok-4.6-xhigh-fast`; longest step/start→first-chunk **62479 ms** at `(turn 15, step 6)` times `1786688141733` → `1786688204212`. Large later prompts appear (`inputTokens` 211845 on a **222 ms** step) — prompt size alone does not explain the 90s idle retries.

`session-51ae1fa6` / `session-c0272aae` had **no** streamed `上游长时间无输出` (idle retry is intermittent, not every chat).

Session logs do **not** store per-hop proxy timings (no TLS handshake duration, no GetUsableModels duration). Many `step/end` events carry `{ turn, step }` only — no duration field. TTFT must be inferred from `time` deltas.

## 6. Ranked latency sources (felt slowness)

Order is **felt impact**, not measured milliseconds for every row. Only the 90s stall has a session-matched constant.

1. **Cursor-side think / queue / `api2.cursor.sh` wait** (not the proxy). Silence until `thinkingDelta` / `textDelta`. Amplified by DSH default `xhigh` → wire id `cursor-grok-4.6-xhigh-fast`. Session medians of first-chunk wait are seconds; idle cases hit ~90s before the proxy even retries.
2. **90s idle stall then a new Agent `Run` with full flatten** (`STALL_MS`, `handleCursor` catch, `messagesToPrompt`). Session-95fd29ee: **90076 ms** then a second Run; first real text **101402 ms** after step start. This is the worst proxy-owned multiplier.
3. **Protocol mismatch on the tool loop**: each DSH tool step is a chat-completions turn; the proxy must pause (`300ms` flush), return `tool_calls`, wait for DSH, then `resume` — or open a **new** HTTP/2 `Run` if the hold is lost / abandoned. Native Cursor stays on one Agent stream.
4. **New `http2.connect()` per Run and per catalog miss** (no pool). Cheap vs 90s, but paid on every new conversation, every idle retry, and every `GetUsableModels` miss.
5. **Full transcript flatten when `conversationState` is missing** (cold start, TTL 30 min, idle retry, tool-result tails). Extra upstream ingest; not the same as OpenRouter prefix cache.

Honorable mentions (usually smaller): 10-minute `GetUsableModels` RPC on miss; 300ms MCP flush; 10s keep-alive text that *looks* like thinking; DSH `TRANSPORT` retries after `terminated`.

## 7. Claim index (file + function)

- Hop / listen: `src/index.ts` `handleProxy`; `src/types.ts` prefixes + `DEFAULT_CONFIG`; `settings.yaml`; `config.json` (timeout/baseUrl only).
- Completions facade: `src/routes/cursor.ts` `handleCursor`, `usableModels`, keep-alive, idle retry catch.
- Run / HTTP/2 / stall / 300ms / GetUsableModels: `src/cursor/client.ts` `HeldCursorRun.begin`, `close`, `rememberMcpCall`, heartbeat, `getModels`, `chat`.
- Flatten / tools / images: `src/cursor/converter.ts` `messagesToPrompt`, `requestPrompt`, `extractMcpTools`, `trailingToolResults`, `extractCursorImages`.
- Catalog: `src/cursor/catalog.ts` `resolveCursorModel`, `groupCursorModels`.
- State / lane: `src/cursor/usage.ts` `peekConversationState`, `rememberConversationState`, `CONVERSATION_STATE_TTL_MS`; `src/cursor/lane.ts` `conversationLane`.
- Metrics only: `src/runtime.ts` `ProxyRuntime.begin` (no TTFT).
- DSH client: `@earendil-works/pi-ai` `openai-completions.js` `createClient`, `buildParams` (`stream: true`), `detectCompat` (`sendSessionAffinityHeaders: false`).

## Verdict

The architecture is the **main structural issue**: an OpenAI chat-completions facade over a stateful Cursor Agent `Run`. That mismatch explains the extra hops, flatten, hold/resume, and idle re-bootstrap.

The architecture is **not** “badly designed” in the sense of accidental slowness. Median first-chunk wait is a few seconds. Most per-request proxy costs (new `connect`, catalog cache, 300ms flush) are small next to Cursor think/queue and the **90s idle → new Run** path, which session logs confirm on `session-95fd29ee-…`.
