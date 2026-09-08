/**
 * The floating-card rules for 随手笔记.
 *
 * The card layer is the part the user feels: if a second shortcut press
 * stacks a blank card on a blank card, or a card survives a reload and covers
 * the workspace, the plugin stops being "随手" and starts being clutter.
 *
 * Assertions read the BUILT bundle: the bundler inlines module-level
 * constants, so source-level names like `MAX_OPEN_CARDS` no longer exist there.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

test('a second new-note press reuses the empty card instead of stacking one', () => {
  assert.match(client, /card\.fresh && card\.noteId === null && this\.bodyOf\(card\)\.trim\(\) === ""/, 'an empty fresh card is detected')
  assert.match(client, /revealCard\(existing\.key\)/, 'the existing empty card is reused')
})

test('a shortcut from inside a card always opens another card', () => {
  assert.match(client, /openNewCard\(cardKeyOf\(target\)\)/, 'the focused card is passed through')
  assert.match(client, /offsetGeometry\(origin\)/, 'the new card is offset from the selected one')
  assert.match(client, /addEventListener\("keyup", onKey, true\)/, 'IME-swallowed keydowns still match on keyup')
})

test('the number of open cards is capped at ten', () => {
  assert.match(client, /cards\.length >= 10/, 'both open paths enforce the cap')
  assert.match(client, /最多同时打开 .*10.* 张便签/, 'hitting the cap tells the user why')
})

test('clicking a card raises it above its siblings', () => {
  assert.match(client, /z: this\.state\.topZ \+ 1/, 'a new or focused card takes the top')
  assert.match(client, /topZ: z/, 'the counter advances so the next press wins')
})

test('the layer is click-through, so DSH stays usable behind the cards', () => {
  assert.match(client, /pointer-events:\s*none/, 'the overlay host does not swallow clicks')
  assert.match(client, /pointer-events:\s*auto/, 'the cards opt back in')
})

test('cards portal onto document.body above the Codex sticky user bubble', () => {
  // The sticky question pins to body at z-index 45. A card left inside
  // shell.overlay cannot climb out of that stacking context.
  // The bundler emits `(0, react_dom.createPortal)(..., document.body)`.
  assert.match(client, /react_dom\.createPortal\)\(/)
  assert.match(client, /createPortal\)\([\s\S]{0,2400}document\.body/)
  assert.match(client, /z-index:50;pointer-events:none;position:fixed;inset:0/)
})

test('imported notes from the session map open an existing or new card', () => {
  assert.match(client, /adoptImportedNote\(snapshot, createdId\)/)
  assert.match(client, /dsh-quick-notes:import/)
  assert.match(client, /openNote\(createdId\)/)
})

test('opening an already-open note focuses it instead of duplicating it', () => {
  // The class method, not the `store.openNote(id)` call site in the layer.
  const definition = client.slice(
    client.indexOf('openNote(id) {\n'),
    client.indexOf('focusCard(key) {'),
  )
  // Everything before the cap check is the "already open" path; the creation
  // code below it only runs when the note has no card yet.
  const earlyPath = definition.slice(0, definition.indexOf('cards.length >= 10'))
  assert.match(earlyPath, /cards\.find\(\(card\) => card\.noteId === id\)/, 'an existing card is found by note id')
  assert.match(earlyPath, /revealCard\(existing\.key\)/, 'and focused rather than re-created')
  assert.doesNotMatch(earlyPath, /cards: \[\.\.\./, 'the focus path never appends a card')
})

test('shortcuts are window-level; modifier chords still fire while typing', () => {
  assert.match(client, /addEventListener\("keydown", onKey, true\)/, 'shortcuts capture before the composer')
  assert.match(client, /!\(event\.metaKey \|\| event\.ctrlKey \|\| event\.altKey\) && isTypingTarget/, 'unmodified typing is left alone')
  assert.match(client, /event\.code === codeOf/, 'IME Process keys still match the physical key')
  assert.match(client, /revealCard\(existing\.key\)/, 'a second press focuses the empty card')
  assert.match(client, /focusTick/, 'reuse steals editor focus, not just z-index')
})

test('shortcuts also bind inside same-origin iframes', () => {
  assert.match(client, /querySelectorAll\("iframe"\)/, 'session-card drawers live in the Synapse iframe')
  assert.match(client, /frame\.contentWindow/, 'the iframe window receives the same handler')
  assert.match(client, /MutationObserver/, 'late-mounted map frames are bound too')
})

test('Escape closes search, or saves and closes the focused card', () => {
  assert.match(client, /key === "Escape"/)
  assert.match(client, /setSearchOpen\(false\)/)
  assert.match(client, /closeCard\(cardKey\)/)
  assert.match(client, /data-quick-note-card/)
})

test('a new card creates one note and later flushes update it', () => {
  assert.match(client, /creating\.(get|set)\(key/)
  assert.match(client, /createdId/)
  assert.match(client, /body\.trim\(\) === "" && card\.noteId === null/)
  assert.doesNotMatch(
    client,
    /note\.body === body && note\.updatedAt/,
    'create must not guess the new row by body text',
  )
})

test('cards resize from edges as well as the corner', () => {
  assert.match(client, /ns-resize/, 'top and bottom stretch height only')
  assert.match(client, /ew-resize/, 'left and right stretch width only')
  assert.match(client, /nesw-resize/)
  assert.match(client, /data-resize/)
  assert.match(client, /resizeGeometry\(/)
  assert.match(client, /createPortal\)\([\s\S]{0,200}shield/, 'a shield keeps the pointer off iframes')
})

test('cards opt out of the Desktop window-drag region', () => {
  // DSH-Desktop marks <header> as -webkit-app-region:drag. The card chrome
  // must be a div, must declare no-drag, and must follow the pointer on
  // window — setPointerCapture on a click-through overlay child is a no-op
  // in Electron.
  assert.match(client, /-webkit-app-region:\s*no-drag/)
  assert.match(client, /addEventListener\("pointermove",/)
  assert.match(client, /closest\("button, input, textarea, a"\)/)
  assert.doesNotMatch(client, /jsx\("header"|createElement\("header"/)
})

test('a blank new card hides chrome the user cannot use yet', () => {
  assert.match(client, /cardBlank/)
  assert.match(client, /bare: blank/)
  assert.match(client, /note === null && card\.draft\.trim\(\) === ""/)
})

test('pin on a card toggles instead of always pinning', () => {
  assert.match(client, /setPinned\(id, current\?\.pinned !== true\)/)
})

test('the editor hydrates once per card, not on every keystroke', () => {
  // Binding the surface to the live markdown / updatedAt rewrites innerHTML
  // on each emit and makes typing (especially IME) impossible.
  assert.match(client, /revision: card\.key/)
  assert.match(client, /\[props\.revision\]/)
  assert.doesNotMatch(
    client,
    /\[props\.markdown,\s*props\.revision\]/,
    'the live markdown echo must not reload the surface',
  )
})

test('cards are not restored after a reload', () => {
  // Geometry lives in memory only: the store starts with an empty card list
  // and nothing reads them back from storage.
  assert.match(client, /cards: \[\]/, 'the store starts with no cards')
  assert.doesNotMatch(client, /localStorage[\s\S]{0,80}cards/, 'card geometry is never persisted')
})
