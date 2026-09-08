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

## Tool process folding

Live events pair tool calls and results by `callId` and count them towards the turn's card instead of creating standalone conversation cards. Tool arguments and outputs are **not** stored in the canvas metadata; they are re-read from the DSH session for the detail view.

Legacy v3 migrations did not always have durable call IDs. Those records pair each tool call with the next tool result by order during migration.

## Browser-local state

Some interaction state, such as dragged card positions and branch anchors, may be cached in browser local storage to keep the canvas responsive. Durable workspace metadata is still written through the Synapse service.

Private-browsing restrictions or local-storage failures must not prevent DSH conversations from operating; they only reduce persistence of visual preferences.

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
