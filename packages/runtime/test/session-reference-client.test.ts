/**
 * The client-side session reference.
 *
 * `dsh-session-reference` owns this format: a session id serializes to
 * `dsh-session:<base64url(JSON id)>` and renders as `@[label](uri)`, which is
 * what a composer resolves when you `@`-mention another session. `./host`
 * re-exports that implementation; `./client` cannot, because it goes through
 * `Buffer` and the browser has none.
 *
 * So the client encoder is a reimplementation, and the risk is DRIFT — our copy
 * producing a string the host will not resolve. These tests check real agreement
 * with the official module rather than a hand-written expectation, which is
 * exactly why they live in this package: a plugin may not import `@deepseek-ai/*`
 * (`scripts/check-dependency-contracts.mjs` enforces it), so a plugin could only
 * ever assert its own output against itself.
 */

import { test, expect } from 'vitest'

import {
  SESSION_REFERENCE_SCHEME,
  encodeSessionReferenceUri,
  formatSessionReferenceMention,
} from '../src/client.ts'
// The package ROOT: the encoding functions are exported only from there, and its
// `Buffer` use is fine here because these tests run in Node. (The client cannot
// import this module at all, which is the whole reason `../src/client.ts` exists.)
import * as official from '@deepseek-ai/dsh-session-reference'

/** Ids covering the shapes the encoding has to survive. */
const IDS = [
  'session-852f1b1d-a5d8-49f0-a1e2-f3bb13d0a7f3',
  'abc',
  '',                       // empty is a legal (if odd) id and must not throw
  'ünïcödé-会话-🎉',        // JSON quoting is what keeps this lossless
  'quote"and\\backslash',
  'a'.repeat(300),
]

test('a session id encodes into the documented canonical form', () => {
  // Known vector: JSON.stringify('abc') is `"abc"` (5 bytes) => base64url `ImFiYyI`.
  expect(encodeSessionReferenceUri('abc')).toBe('dsh-session:ImFiYyI')
  expect(SESSION_REFERENCE_SCHEME).toBe('dsh-session:')
})

test('the encoding is base64url without padding', () => {
  // `+`, `/` and `=` would all break a URI embedded in the Markdown mention.
  for (const id of IDS) {
    const payload = encodeSessionReferenceUri(id).slice(SESSION_REFERENCE_SCHEME.length)
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(payload.endsWith('=')).toBe(false)
  }
})

test('the URI is byte-identical to the official encoder', () => {
  // The point of the whole module: our copy must be indistinguishable from the
  // host's, or a pasted reference silently fails to resolve.
  for (const id of IDS) {
    expect(encodeSessionReferenceUri(id)).toBe(official.encodeSessionReferenceUri(id as never))
  }
})

test('the official decoder accepts what we produce', () => {
  // The real acceptance test — not "the strings match" but "the host can read
  // it back", which is what decides whether a pasted mention works.
  for (const id of IDS) {
    expect(official.decodeSessionReferenceUri(encodeSessionReferenceUri(id))).toBe(id)
  }
})

test('the mention is byte-identical to the official formatter', () => {
  const labels = [
    'plain title',
    'has [bracket] inside',
    'back\\slash',
    'close]bracket',
    '中文标题 · with dot',
    undefined,
  ]
  for (const label of labels) {
    const reference = label === undefined ? { sessionId: 'abc' } : { sessionId: 'abc', label }
    expect(formatSessionReferenceMention(reference)).toBe(
      official.formatSessionReferenceMention(reference),
    )
  }
})

test('an opening bracket in a label is not escaped', () => {
  // Escaping it would still round-trip — the official parser unescapes any `\x` —
  // so this is the one difference a round-trip test could NOT catch. Pin the
  // exact string instead, because matching the host's bytes is the requirement.
  expect(formatSessionReferenceMention({ sessionId: 'abc', label: 'a[b]' }))
    .toBe('@[a[b\\]](dsh-session:ImFiYyI)')
})

test('a missing label falls back to the id, so the mention is never empty', () => {
  expect(formatSessionReferenceMention({ sessionId: 'abc' }))
    .toBe(`@[abc](${official.encodeSessionReferenceUri('abc' as never)})`)
})

test('the client signature matches the host export, so the two are interchangeable', () => {
  // `./host` re-exports the official formatter under this same name, and it takes
  // an OBJECT. If the client twin took positional args, importing the wrong entry
  // point would compile and then misbehave at runtime (reading `.sessionId` off a
  // string). Same name must mean same call shape.
  const viaClient = formatSessionReferenceMention({ sessionId: 'abc', label: 'x' })
  const viaOfficialShape = official.formatSessionReferenceMention({ sessionId: 'abc' as never, label: 'x' })
  expect(viaClient).toBe(viaOfficialShape)
})
