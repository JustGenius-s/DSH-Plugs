## Plugin Dependencies
- Prefer the shared layer under `packages/` over a direct official dependency.

## Code
- Test functions and interfaces only — never render components or assert the DOM.
- Move UI logic into a plain function before testing it.
- Keep tests in the package-level `test/` directory, not `src/`.

## Desktop Window Chrome (DSH-Desktop)

DSH-Desktop hides the macOS title bar (`titleBarStyle: 'hiddenInset'`) and
injects `-webkit-app-region` rules. Electron turns those into one ordered list
of drag/no-drag rects: **drag adds, no-drag subtracts, and the later rect wins**
(paint order). An element that declares no `app-region` emits **no rect at all**,
so it cannot occlude a drag region beneath it.

- Any layer that covers the window's top band (an overlay, a modal, a popover,
a full-viewport panel) **must declare `no-drag` on its own root** — otherwise the
shell's drag region passes through it and its controls become window grips.
- Portaled primitives inherit nothing: the rule belongs on the portaled card,
not on the trigger.
- Do not stack a `drag` rect over interactive controls. If a surface needs a
window grip, give it a dedicated band and keep every control `no-drag`.
- Write the pair (`-webkit-app-region` + `app-region`) so the intent survives
without the prefix.

## Dependency Updates
- Update dependencies at most weekly, then record the date below.
- Last updated: 2026-09-09
