# dsh-codex client architecture

`dsh-codex` contains product features mounted into DSH's client extension
surfaces. Keep dependencies flowing in one direction:

```text
host-adapters / infrastructure
              ↓
application controllers
              ↓
domain models and observable state
              ↓
React presentation
```

## Boundaries

- `core/` contains lifecycle and observable primitives. It must not import a
  feature or React.
- `host-adapters/` is the only layer allowed to depend on undocumented host
  object shapes or DOM probes. Every such assumption belongs behind a typed
  interface and is tested as a contract.
- A feature controller owns long-lived resources such as sockets, timers and
  subscriptions. Controllers expose commands and observable snapshots and
  always provide `dispose()`.
- React components own only short-lived presentation state. A component must
  not mirror an application snapshot field into a ref merely to make an
  asynchronous callback work; the callback belongs on the controller.
- Domain models are the single source of truth. Renderers consume them; a
  renderer must not maintain a competing layout model.
- Cross-feature calls use declared services/contracts. They do not reach into
  another feature's component or store implementation.

## Right-Sidebar integration

DSH 0.1.5+ owns the complete right-Sidebar shell, docking layout and tab
lifecycle. `sidebar-right.ts` is the single compatibility adapter for its
registry and keyed body/title slots. Side Chat, Terminal and Git register tab
types; they must not recreate layout, tabs, launchers, persistence or close
chrome.

DockSurface only renders the active body in each docked pane. Every custom body
therefore uses `sidebar-tab-keep-alive.tsx`: the slot body is a disposable
holder, while the real React root and its DOM stay alive under a key composed
from `(sessionId, tab.id)`. Switching, moving, docking or floating a tab only
detaches and reattaches that root. The renderer receives `visible: false` while
detached so watches and portaled UI go quiet; only `tab.signal` (or feature
disposal) unmounts it. This retains component hooks, uncontrolled DOM state and
scroll positions instead of reconstructing a component from copied state.

File links use the official `dsh-resource://file/**` navigation path. The custom
Files client and Host implementations remain in the tree behind the persisted
`customFilesEnabled` Codex setting. It defaults to `false`; changing it updates
the `files` page takeover, viewer registration and Host routes. The page uses
the official registry's `extension`-over-`builtin` behavior, so an existing
`files` tab swaps bodies in place; a resource tab is replaced because it keeps
the viewer kind it opened with. Custom tree state lives in a feature-owned
store keyed by official `(sessionId, tab.id)` as the tree's request/cache model;
the retained renderer additionally preserves its presentation state. `tab.signal` releases
both lifetimes. Terminal cleanup is likewise bound to the official tab
occurrence's `AbortSignal`, never to the disposable DockSurface holder.

Side Chat uses the same retained-root path. A feature-owned metadata channel
shares its temporary session id and first-message title with the separately
mounted official title seat. Switching tabs only detaches its DOM; aborting the
official `tab.signal` unmounts the retained panel and closes the temporary Host
session.

## Prose file mentions

An assistant's closing prose carries inline-code file mentions, rendered by DSH's
markdown sheet as `<code><button title="<path>">token</button></code>`. DSH owns
the vocabulary (`chatFileMentions`, provided by `ui-deliverables`), and a plugin
cannot re-register it: Cordis throws on a second `provide` for a name. What it
routes to is also inconsistent — a tool-produced path opens the right Sidebar,
while a path declared only through `present` POSTs to a native "open in the
default application" route instead.

`features/file-mentions/` therefore adopts the **click**, not the vocabulary. It
listens on `document` in the CAPTURE phase, which runs before React's
root-container listener, so one `stopPropagation()` keeps the host's own handler
from also running. The rules are in `model.ts`:
`mentionPathFromFacts` claims only a button inside `<code>` (every other button in
the transcript — cards, tool rows, the action strip — has a different parent) and
reads the path from its `title`; a modified click is deliberately NOT adopted,
which is what keeps the host's default-application action reachable. An open that
cannot work — no current Session, or a path outside the workspace, which becomes
an `absolute` address the official preview declines — returns `false` and leaves
the event untouched, so the failure mode is the product's own behavior rather
than a dead chip.

## Error reporting

`error-boundary.tsx` is shared, cross-feature client infrastructure — it sits
beside `sidebar-tab-keep-alive.tsx` rather than inside any one feature.

DSH's own `SlotErrorBoundary` already wraps every slot entry, so a render
crash does not take down the app. Its crash face is only
`<div data-slot-error>`: it logs the error to the console and shows the user
nothing. `SidePanelErrorBoundary` renders the message, `error.stack` and the
React component stack in place with a copy button, so a failure is locatable
without DevTools. `describeError()` is exported separately because
non-render failures (async, Host boundary) should produce the same shape;
`side-chat/panel.tsx` reuses it for its error bar.

## Lifecycle rule

The owner that creates a store, controller, observer or transport disposes it.
Every factory returning a long-lived object must therefore expose `dispose()`
or return an explicit disposer alongside the object.
