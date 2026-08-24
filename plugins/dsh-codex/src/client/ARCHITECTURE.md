# dsh-codex client architecture

`dsh-codex` contains a small client platform (side panels) and several product
features. Keep dependencies flowing in one direction:

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

## Side-panel platform

The side-panel service is infrastructure. Terminal, Files, Git and Quick
Actions are consumers. Platform code may know panel contracts but must not
import feature-specific state or views.

## Lifecycle rule

The owner that creates a store, controller, observer or transport disposes it.
Every factory returning a long-lived object must therefore expose `dispose()`
or return an explicit disposer alongside the object.
