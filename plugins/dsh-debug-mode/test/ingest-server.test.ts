import { describe, expect, it } from 'vitest'
import { browserIngestUrl } from '../src/ingest-server.ts'
import { DEBUG_INGEST_PORT, LOGS_PATH } from '../src/shared.ts'

describe('browserIngestUrl', () => {
  it('stays on the stable sidecar port, not the Desktop GUI port', () => {
    expect(browserIngestUrl()).toBe(`http://127.0.0.1:${DEBUG_INGEST_PORT}${LOGS_PATH}`)
    expect(browserIngestUrl()).not.toContain(':51830')
  })
})
