# Architecture and runtime boundaries

## Purpose

`dsh-synapse` is a presentation and organization layer for DeepSeek Harness conversations. It turns existing DSH sessions, turns, and forks into a visual map without replacing the systems that own those conversations.

## Web profile integration

The package contributes `cordis.patch.yml`, which inserts the `dsh-synapse` service into the DSH `web` profile. It reuses the existing DSH Web server and client runtime.

The plugin:

- does not start a second HTTP server;
- does not create a second model or agent runtime;
- does not replace DSH authentication or permission checks;
- does not support non-Web profiles unless those profiles explicitly add the plugin.

## Conversation ownership

DSH session logs remain the source of truth for conversation content and lifecycle. Native DSH operations own:

- creating and opening sessions;
- sending follow-up messages;
- forking sessions;
- archiving sessions;
- model and tool execution;
- permission and approval decisions.

Synapse projects committed DSH events into cards and sends user actions back through the native DSH session bridge.

Card forks use the authenticated `POST /synapse/api/fork-card` route and the
host's agent factory. The selected message identity resolves the source turn,
and its `turn/end` is the inclusive history boundary. Unlike native `atSeq`
forking, this does not extend the seed to the next `turn/start`: that interval
can contain the next prompt's durable inbox insertion. The child inbox is also
cleared before publication so input queued during the selected turn cannot
replay. Only then does the bridge submit the new prompt. Parent history and
pending input remain untouched.

## Canvas metadata

By default, Synapse stores canvas metadata at:

```text
$DSH_HOME/synapse/workspaces.json
```

The file contains organizational state: workspace mapping, card summaries, card layout, and fork anchors. It does not replace session logs.

## Card summaries and detail on demand

Version 5 stores **one card per turn**, not a copy of the session message log. Each card holds only what the canvas renders:

| Field | Purpose |
|---|---|
| `question` | the user question (capped at 600 chars for display) |
| `answer` / `answerSeq` | the turn's final assistant reply and its event seq (capped at 2,400 chars) |
| `error` | the failure text, when the turn did not complete |
| `processCount` / `processIds` | how many tool invocations the turn made, and their `callId`s |
| `seq` | the durable event seq, used for branching and detail lookup |

The full text lives in the DSH session log. Opening a card's detail view re-reads that turn from the session — every assistant step plus each tool call's arguments and output, uncapped — through `GET`-free `POST /synapse/api/turn-detail`:

1. a **live** session is read from its in-memory event log (no I/O);
2. an **archived or cold** session is inspected through persistence (read-only: it does not publish the session or commit crash recovery).

Results are cached per turn in the browser, so reopening a card is instant.

Rationale: the previous model copied every message — and every tool output — into `workspaces.json`. One 50 KB `bash` result alone was ~4% of a 12 MB file, and tool outputs accounted for half of it, even though the canvas never renders them. Card summaries plus detail-on-demand cut that file by ~95% while the detail view gained the complete tool output it previously truncated.

## Projection model

With `autoProjection` enabled, committed DSH session events are grouped by working directory and projected into the corresponding Synapse workspace.

Each user question becomes a conversation card. The following assistant messages are folded into that turn, and the final assistant reply becomes the card's `answer`. Forked sessions connect to the parent turn at the durable DSH seed boundary rather than at an arbitrary canvas coordinate.

Card fields are capped for display as described above; the detail view is the uncapped path. Projection writes are coalesced during event bursts, and live updates reuse cached Markdown and patch the active card instead of rebuilding the complete canvas. Card coordinates remain visual metadata only and never determine conversation lineage.

## Reversible card visibility

The card footer's hide action changes only `turn.hidden` in canvas metadata.
Renaming starts by double-clicking the card title; the inspector keeps its
direct rename button. Single title clicks do not open the inspector or remount
the card, leaving the double-click target stable.
It never archives a DSH session, edits a message log, removes a turn, or
changes model context. The previous branch-delete UI and archive bridge have
been removed. Legacy `hiddenSessionIds` and the thread-delete API remain
compatible; this feature does not restore previously removed sessions.

`PATCH /synapse/api/cards/visibility` accepts `{ cards, hidden }`, with 1 to 100
targets per request. Each target carries `threadId`, `cardKey`, and the durable
`messageId` or card identity when available. Browser-only submission IDs are
not persistence addresses. A batch validates all targets before writing,
bumps each changed workspace's revision once, and rolls back in-memory changes
if saving fails. Sequence rebasing preserves visibility alongside custom titles.
The client batches larger restores and retains already-confirmed batches if a
later batch fails.

The complete graph is built before display decisions. A hidden turn renders
as a small restore marker at its original center, preserving all incoming and
outgoing branch connections, original turn numbers, and the real follow-up
tail. Hiding a collapsed node temporarily ignores that node's fold preference;
its descendants are not implicitly hidden. Restoring a card expands the
necessary ancestor path. Dragged positions are retained.

Restore is driven from each hidden card's marker. Running
turns, pending submissions, blank placeholders, and active draft anchors cannot
be hidden. Optimistic display changes survive polls until the write settles;
pre-write fetches are retried and late responses merge visibility only, without
replacing newer answers or switching the user's selected session.

## Tool process folding

Live events pair tool calls and results by `callId` and count them towards the turn's card instead of creating standalone conversation cards. Tool arguments and outputs are **not** stored in the canvas metadata; they are re-read from the DSH session for the detail view.

Legacy v3 migrations did not always have durable call IDs. Those records pair each tool call with the next tool result by order during migration.

## Browser-local state

Some interaction state, such as dragged card positions and branch anchors, may be cached in browser local storage to keep the canvas responsive. Durable workspace metadata is still written through the Synapse service.

Private-browsing restrictions or local-storage failures must not prevent DSH conversations from operating; they only reduce persistence of visual preferences.

Opening a turn preview also opens that session's client event window through
`session.open()`, the same read-only path used by side chat. This is distinct
from `sessions.open(id)`, which changes the current conversation. The preview
waits for newly created sessions to appear, subscribes to both the session and
its Chat target, and switches from the stored-detail fallback to live rendering
as soon as the window is ready. Reasoning, tool state, and answer tokens arrive
through the host's existing stream; closing the preview releases its listeners.

## Stable live workflows

New conversations, follow-ups, and forks create a local card before waiting for
the host. A submission has an operation ID, a stable card ID, an owning
workspace, and a pre-send user-event cursor. Committed turns reconcile against
that cursor, not question text. Browser card identities survive the transition
from a placeholder to the committed event sequence.

Failed submissions keep their text and can be retried or dismissed. A retry
reuses an already-created fork; the host bridge also deduplicates in-flight and
accepted actions by operation ID for its lifetime. This is not a durable
exactly-once guarantee across host restarts. Late callbacks cannot insert into
another workspace or change its selected card.

Each branch reserves a stable lane. Existing card positions are retained when
other branches grow; only the explicit organize action clears automatic layout
state. Live updates are batched for every dirty session, target a card identity
rather than the last mounted element, and resume after gestures. Background
projection refreshes patch cards without replacing the canvas.

New projections carry per-turn `status`, `turnNumber`, and `endSeq`. An
intermediate assistant message does not complete the turn; `turn/end` does.
Workspace revisions make new turns and changed answers observable without
depending on session-count changes.

Detail reads require the requested event address to resolve. They do not
silently substitute the latest live turn or a fork's inherited first turn.
For legacy root cards whose seq changed during session-log migration, a
recovery read verifies the original, unambiguous question before accepting an
indexed result. A known message ID takes precedence over seq. Unresolved cards
keep a clearly labeled summary and a retry action, rather than claiming that a
completed message is still pending.

Assistant Markdown contains text blocks only. Structured tool calls are
rendered once as tool rows, not flattened into prose. The client also removes
the older endpoint's exact tool-name/argument suffix when the corresponding
execution record is present. New structured responses bypass this compatibility
normalization so literal examples remain untouched. Tool rows have individual
error boundaries, and terminal labels cover collapsed-output callbacks.

On full-log replay, a changed sequence space is rebuilt only after verifying
the entire stored question prefix. Card identities, custom titles and branch
anchors survive this repair; partial histories never trigger it.
Loaded sessions use live chat subscriptions; cold running sessions refresh the
read-only detail endpoint until completion. This fallback follows committed
events, not uncommitted tokens. Closing the pane aborts its pending read.
Inspector caches track turn revisions and are refreshed on completion.

Host changes in `index.js` require a DSH Web restart. Client hot replacement
alone does not enable the cursor endpoint or per-turn projection lifecycle.

## Host validation

The `/synapse` endpoint always accepts `localhost` and `127.0.0.1`. Additional LAN or proxy authorities must be listed in `trustedHosts` as a host or `host:port` value.

This validation is part of the Web surface and does not replace broader network access controls.

## Model and KV-cache impact

Synapse reads session events only after DSH commits them. It does not add or modify:

- system prompts;
- user request content;
- model request headers;
- tool schemas or registries;
- provider routing;
- approval context.

As a result, the plugin has no direct model-experience effect and does not invalidate an otherwise reusable KV-cache prefix.

## Operational limitations

- Only the `web` profile is supported by the bundled patch.
- Canvas metadata and session content have different owners and backup requirements.
- A single shared metadata file is not a multi-writer database.
- Browser state can be cleared independently from DSH Home data.
- Historical migrations may have less precise tool-call pairing than live projection.

## Related documentation

- [Chinese user guide](zh-CN/README.md)
- [English user guide](en/README.md)
- [Development and release guide](development.md)
- [Project overview](../README.md)
