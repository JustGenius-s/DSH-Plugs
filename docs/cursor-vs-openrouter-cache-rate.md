# Why Cursor shows 0% cache in DSH, while OpenRouter does not

Date: 2026-08-22  
Question: Cursor-backed agents in DSH report **缓存命中 0%**, but the same GUI shows a real cache rate after an OpenRouter API key is configured.

This is **not** a DSH stats-widget bug. The widget only prints what the provider usage sample contains. OpenRouter samples include `cacheReadTokens`. Cursor-proxy samples almost never do, and the Cursor Agent conversation the proxy starts is also unlikely to reuse a prefix cache.

## How the GUI computes “缓存命中”

`dsh-client-ui-conversation` (`StatsLine`) treats cache hit as:

```
cacheReadTokens / (uncachedInputTokens + cacheReadTokens + cacheWriteTokens)
```

Source: `@deepseek-ai/dsh-client-ui-conversation` `cacheHitPercent` / `billedInputTokens`.

`dsh-token-meter` folds `usage.cacheReadTokens ?? 0`. If a step never carries that field, the session total stays 0 and the line shows **0%**.

`dsh-llm-pi-ai` `mapUsage` only forwards cache fields when they are **> 0**:

```js
...usage.cacheRead > 0 ? { cacheReadTokens: usage.cacheRead } : {}
```

So a Cursor reply that has `prompt_tokens` but no `prompt_tokens_details.cached_tokens` is stored as `{ inputTokens, outputTokens }` only.

## What OpenRouter does (why the number is non-zero)

1. DSH talks to OpenRouter as a normal OpenAI Chat Completions stream (`settings.yaml` `llm-pi-ai.providers.openrouter`).
2. pi-ai sends the **structured** `messages` array and asks for `stream_options.include_usage`.
3. OpenRouter [automatic / implicit prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching) hashes a **stable prefix**. Later turns that keep the same system prompt + earlier messages report hits in `usage.prompt_tokens_details.cached_tokens`.
4. pi-ai `parseChunkUsage` maps that field (also `prompt_cache_hit_tokens`) to `cacheRead`. Documented as OpenAI / OpenRouter semantics in `@earendil-works/pi-ai` `openai-completions.js`.
5. Local session logs match this: an OpenRouter workspace session had **138 / 140** usage rows with `cacheReadTokens > 0` (example: `{ inputTokens: 3932, outputTokens: 234, cacheReadTokens: 12480 }`).

OpenRouter does **not** need `prompt_cache_key` for this implicit path. pi-ai only emits `prompt_cache_key` when the base URL is `api.openai.com` or `cacheRetention === "long"`. A custom OpenRouter profile still gets automatic prefix cache + usage details.

For Anthropic models on OpenRouter, pi-ai also stamps Anthropic `cache_control` markers (`cacheControlFormat: "anthropic"` when `model.id` starts with `anthropic/`). That is extra; Grok / stealth models rely on implicit prefix cache.

Official references:

- [OpenRouter prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching)
- [OpenRouter sticky routing + cache cost](https://openrouter.ai/blog/tutorials/prompt-caching-sticky-routing/)
- [OpenRouter implicit caching vs retention](https://openrouter.ai/blog/insights/is-implicit-caching-prompt-retention/)

## What the Cursor path actually is

Your default model is `cursor` / `cursor-grok-4.6-fast`. That is **not** Cursor’s native IDE client. It is:

```
DSH (pi-ai openai-completions)
  → http://127.0.0.1:18765/dsh-proxy/v1
  → @tencent/dsh-tencent handleCursor
  → Cursor Agent HTTP/2  /agent.v1.AgentService/Run
```

Configured in `~/.dsh/settings.yaml` (`baseURL: http://127.0.0.1:18765/dsh-proxy/v1`) and documented in `@tencent/dsh-tencent` README.

Two independent failures sit on that path.

### 1. Display: Cursor usage almost never includes cache fields

The proxy **can** emit OpenAI-shaped cache fields (`buildOpenAiUsage` writes `prompt_tokens_details.cached_tokens` and `prompt_cache_hit_tokens` when `cacheReadTokens > 0`).

Those numbers come from `HeldCursorRun.readTurnUsage`, which only looks at a fixed set of names on `turnEnded` / checkpoint / `tokenDetails`:

- `cacheReadTokens`, `cache_read_tokens`
- `cachedTokens`, `cached_tokens`
- `promptCacheHitTokens`, `prompt_cache_hit_tokens`

It does **not** read nested OpenAI-style `prompt_tokens_details.cached_tokens` on the Cursor Agent frame. If Cursor puts cache on another oneof, or only reports `inputTokens` / `usedTokens`, the proxy stores `cacheReadTokens = 0` and **omits** the details object.

Session evidence (DSH-Plugs Cursor chats, zstd session logs):

| Session | usage rows | cache field present | typical missing sample |
| --- | --- | --- | --- |
| `session-95fd29ee-…` (this workspace, current) | 91 | 0 | `{ inputTokens: 4722, outputTokens: 145 }` |
| `session-22f2b360-…` | 463 | 2 | `{ inputTokens: 4728, outputTokens: 106 }` |
| `session-8b3f2dc1-…` | 275 | 4 | `{ inputTokens: 4726, outputTokens: 132 }` |

When a rare Cursor sample *does* include cache, it often looks like `{ inputTokens: 0, cacheReadTokens: 81509 }` — i.e. Cursor sometimes reports a cache bag, but most steps never do. Those rare hits are enough to prove the GUI pipeline works **if** the proxy forwards a non-zero `cached_tokens`.

`resume()` also zeros cache counters (`resetUsage` / `resetStepUsage`) at every tool-result turn. If the next `turnEnded` has no cache field, that step is logged as uncached input only.

### 2. Actual cache: each Cursor run is a new conversation with a flattened prompt

Even if usage reporting were perfect, the request shape is hostile to prefix cache.

**New conversation every request.** `HeldCursorRun.begin` always sends:

```js
conversationState: {}
conversationId: options.conversationId || randomUUID()
```

`handleCursor` never sets `options.conversationId`. `conversationLane()` exists only to hold MCP tool sessions on the proxy; it is not passed as Cursor `conversationId`.

So Cursor Agent sees a brand-new conversation id and empty state on every DSH LLM call (including every tool-loop continuation that is not a held-run resume).

**Prompt is flattened.** `messagesToPrompt` concatenates system / user / tool text into **one** user `text`. Assistant tool-call messages are dropped. The wire history is not the same structured prefix DSH sent.

xAI (Grok) cache is prefix-based and breaks when the shared prefix changes. Official notes:

- [What breaks caching](https://docs.x.ai/developers/advanced-api-usage/prompt-caching/multi-turn)
- [Maximizing cache hits](https://docs.x.ai/developers/advanced-api-usage/prompt-caching/maximizing-cache-hits)
- [How prompt caching works](https://docs.x.ai/developers/advanced-api-usage/prompt-caching/how-it-works)

Cursor’s own product keeps a stable conversation and a stable prefix. This proxy does not.

**Session affinity is withheld.** DSH does pass `sessionId` into pi-ai, but `dsh-llm-pi-ai` marks `sendSessionAffinityHeaders` as **withhold** for profile `compat`. Default pi-ai `detectCompat` also sets `sendSessionAffinityHeaders: false`. The Cursor proxy therefore never receives `x-session-id` / `session_id` from DSH on the completions request (unless something else adds it). Lane fallback then hashes first system+user text (`msg:…`) and still does not set Cursor `conversationId`.

**`prompt_cache_key` is not sent** to the localhost proxy (`baseURL` is not `api.openai.com`). That only matters for OpenAI-style explicit cache keys; Cursor Agent does not speak that body field anyway.

## Side-by-side

| Layer | OpenRouter | Cursor via dsh-proxy |
| --- | --- | --- |
| Transport | Official Chat Completions | Local OpenAI façade over Cursor Agent Run |
| Messages | Structured `messages[]` | Flattened into one `userMessage.text` |
| Conversation id | Implicit prefix hash on OpenRouter | New `randomUUID()` every Run |
| Cache request hints | Automatic prefix cache; Anthropic markers when `anthropic/*` | None |
| Usage details | `prompt_tokens_details.cached_tokens` | Usually absent; proxy only copies known Cursor field names |
| DSH `mapUsage` | Forwards `cacheReadTokens` | Omits field (0) |
| GUI | Non-zero 缓存命中 | 0% |

## What this is *not*

- Not a missing OpenRouter-only widget. Same `StatsLine` for every provider.
- Not “Grok cannot cache.” Native xAI / OpenRouter Grok routes can report cache when the prefix is stable ([xAI docs](https://docs.x.ai/developers/advanced-api-usage/prompt-caching)).
- Not proof that Cursor billed you 0 cache on Cursor’s own invoice. Cursor’s billing view is a different pipeline. DSH only sees the proxy’s OpenAI usage chunk.

## Adaptation landed in `dsh-tencent` (proxy layer)

Implemented in `/Users/jiahaoqian/proj/dsh-tencent` and copied into the web profile `@tencent/dsh-tencent`. **Numbers are still only forwarded from Cursor frames — never estimated.**

1. **Stable `conversationId`** — `conversationIdFromLane(lane)` strips `sid:` / `msg:` and is passed into every `HeldCursorRun` (no more per-request `randomUUID()` when a lane exists).
2. **Conversation continuity** — checkpoint `conversationState` is remembered per id (30 min TTL). Follow-up turns send that blob back and use `requestPrompt(..., 'delta')` (latest user text only) instead of re-flattening the whole transcript. Cold/stale failures call `forgetConversationState` and retry with a full flatten + empty state.
3. **Wider usage parsing** — `readTurnUsage` in `src/cursor/usage.ts` walks nested `usage` / `prompt_tokens_details` / `tokenDetails` and accepts more cache field aliases. Still returns 0 when Cursor omits the field.
4. **Tool resume** — `resetStepUsage()` clears output/reasoning only; input + cache counters survive until a later frame replaces them with `> 0`.

After installing the built `lib/` into `~/.dsh/profiles/web/node_modules/@tencent/dsh-tencent/lib/`, **restart the DSH host / proxy** so the Cursor route reloads. Then refresh `http://127.0.0.1:55996` and check whether multi-turn Cursor chats start showing non-zero 缓存命中 when upstream reports cache.

## Sources (code)

- `@deepseek-ai/dsh-client-ui-conversation` `lib/client.js` — `cacheHitPercent`
- `@deepseek-ai/dsh-token-meter` `lib/index.js` — `bucketsFrom` / `cacheReadTokens ?? 0`
- `@deepseek-ai/dsh-llm-pi-ai` `lib/index.js` — `mapUsage`, `sendSessionAffinityHeaders: "withhold"`
- `@earendil-works/pi-ai` `dist/api/openai-completions.js` — `parseChunkUsage`, `prompt_cache_key` gate, OpenRouter `cacheControlFormat`
- `@tencent/dsh-tencent` `lib/index.js` (installed web profile) — `readTurnUsage`, `buildOpenAiUsage`, `conversationId: … \|\| randomUUID()`, `handleCursor` chatOptions
- `~/proj/dsh-tencent/src/cursor/{client,converter,routes/cursor,lane}.ts` — same protocol in source form
- `~/.dsh/settings.yaml` — cursor vs openrouter routes
- `~/.dsh/sessions/--Users-jiahaoqian-proj-DSH-Plugs--/*.jsonl.zstd` — usage-field counts
