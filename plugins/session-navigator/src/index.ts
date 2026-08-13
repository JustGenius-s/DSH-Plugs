// Host half of @just-genius/dsh-session-navigator.
//
// A pure client-UI plugin has an empty host body: it exists only so the
// plugin appears in the host Cordis loader tree. The browser half ships
// through `exports["./client"]` and is discovered via the `dsh.client`
// manifest in package.json.

export const name = 'session-navigator'

export function apply() {}
