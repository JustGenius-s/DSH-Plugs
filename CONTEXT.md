# DSH-Plugs

DSH-Plugs is a monorepo of Cordis plugins for the DeepSeek Harness (DSH) web GUI. This context covers the shared domain language used across the plugins, focused on the conversation and side-surface concepts.

## Language

**Side chat (侧边对话)**:
A temporary conversation opened beside the current session. It does NOT load the parent's history — the transcript starts empty and only contains what is asked inside it. It runs in its own session under the same working directory/sandbox as the parent and never writes into the parent session's history. It DOES inherit the parent's CONTEXT: a bounded recall digest of the parent's recent turns is injected as model-facing context at creation, so the side agent answers with the main task in mind. Context is not history — the digest is background the model can consult, not past conversation replayed into the transcript. Used for quick Q&A while the main task keeps running. In dsh-codex each side-panels tab is one side chat (opening a new tab forks a new one; closing it disposes it). Codex calls this `/side`.
_Avoid_: side thread, side panel (that's the UI container), btw question.

**Context digest (上下文摘要)**:
The bounded, read-only summary of a parent conversation handed to a side chat at creation. Built from the parent's surface events only (user and assistant messages, latest turns first, character- and byte-capped), injected as a non-waking `plugin` context message so the transcript stays blank and no turn opens until the user asks something. Marked `recall` — the same information form DSH's `session-reference` service uses for material lifted out of another session.
_Avoid_: history replay, fork seed, summary (ambiguous with compaction summaries).

**Side panel (侧边栏)**:
The right-docked panel host in dsh-codex. It hosts one tab per open instance of a registered `side.panel` slot entry (files, terminal, git graph, side chat). It is the UI container, not the conversation itself.
_Avoid_: sidebar (that's the left nav column).

**Fork**:
A new session created from a completed-turn prefix of a source session. The child inherits the source's cwd, model selection, and `parentSessionId` lineage. DSH's `session.fork` and the host `ctx.agents.create({ seed })` both create forks. Side chats deliberately do NOT fork — they get a context digest instead, which keeps their transcript empty instead of replaying the parent's conversation into it.
_Avoid_: branch (git), spawn.

**Main thread (主线程)**:
The current session's conversation log — the durable history the user is actively working in. A side chat does not load or append to it; it only reads it to build a context digest.
_Avoid_: main chat, main session.

**Sandbox (沙箱)**:
The execution environment a session runs in — its working directory and the file/process access it is granted. Side chats share the parent session's sandbox via the same cwd, so they can read and edit the same files.
_Avoid_: environment, container.
