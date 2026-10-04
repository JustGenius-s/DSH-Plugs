import { describe, expect, it } from 'vitest'
import { corsHeaders, isLocalOrigin } from '../src/cors.ts'

describe('isLocalOrigin', () => {
  it('accepts localhost Vite origins', () => {
    expect(isLocalOrigin('http://localhost:5173')).toBe(true)
    expect(isLocalOrigin('http://127.0.0.1:4173')).toBe(true)
  })

  it('rejects empty and remote origins', () => {
    expect(isLocalOrigin('')).toBe(false)
    expect(isLocalOrigin('https://example.com')).toBe(false)
  })
})

describe('corsHeaders', () => {
  it('echoes a local origin', () => {
    expect(corsHeaders('http://localhost:5173')['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    )
  })
})
