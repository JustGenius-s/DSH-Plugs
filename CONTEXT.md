# DSH-Plugs

DSH-Plugs is a monorepo of Cordis plugins for the DeepSeek Harness (DSH) web GUI. This context covers the shared domain language used across the plugins, focused on the conversation and side-surface concepts.

## Language

**Side chat (侧边对话)**:
A temporary conversation opened beside the current session. Its transcript starts empty and only contains what is asked inside it. It runs in its own session under the same working directory/sandbox as the parent and never writes into the parent session's history. At creation it receives only the parent's identity and guidance to follow the side chat's own requests. It can read the main session's recent conversation through an agent-scoped tool when needed. Used for quick Q&A while the main task keeps running. In dsh-codex each right-Sidebar tab is one side chat (opening a new tab creates a new one; closing it disposes it), and several can be open at once. Codex calls this `/side`.
_Avoid_: side thread, side panel (that's the UI container), btw question.

**Main-session link (主会话关联)**:
An identity-only, non-waking context message injected at side-chat creation. It says which main session can be consulted and makes clear that the main session's tasks are not the side chat's tasks. No history read is needed to open the side chat. When the side-chat user needs main-session information, a scoped tool reads the current effective surface and returns a bounded, read-only excerpt of recent user and assistant turns.
_Avoid_: history replay, fork seed, automatic digest.

**Side panel (侧边栏)**:
The right-docked panel host, owned by DSH itself since 0.1.5. dsh-codex contributes tab TYPES into it (files, terminal, git graph, side chat); DSH owns the docking layout and one record per tab. It is the UI container, not the conversation itself.
_Avoid_: sidebar (that's the left nav column).

**Page tab vs resource tab (页签 / 资源签)**:
The two ways a dsh-codex tab type is opened, and the difference is what decides whether a second instance is possible. A PAGE (`sidebar://<kind>`) is opened by kind — the guide capsule's route — and the store keeps at most one page of a kind per pane, so re-opening it only focuses the tab that already exists. A RESOURCE (`dsh-resource://<type>/<id>`) carries an address the opener mints, so each open is a distinct record. Terminal and side chat are resource tabs for exactly this reason: every terminal and every side chat must be able to coexist. A type may be both — it registers a `patterns` glob for the resource half and still contributes a `guide` entry that opens it by kind; the tab it opens then converts itself to its own resource address on mount.
_Avoid_: tab (ambiguous — every one of these is a tab), duplicate tab (that's the dock kit's copy action).

**Fork**:
A new session created from a completed-turn prefix of a source session. The child inherits the source's cwd, model selection, and `parentSessionId` lineage. DSH's `session.fork` and the host `ctx.agents.create({ seed })` both create forks. Side chats deliberately do NOT fork — they get a main-session link, leaving their transcript empty.
_Avoid_: branch (git), spawn.

**Main thread (主线程)**:
The current session's conversation log — the durable history the user is actively working in. A side chat does not load or append to it when opened; it can read recent turns on demand.
_Avoid_: main chat, main session.

**Sandbox (沙箱)**:
The execution environment a session runs in — its working directory and the file/process access it is granted. Side chats share the parent session's sandbox via the same cwd, so they can read and edit the same files.
_Avoid_: environment, container.
