import { describe, expect, it } from 'vitest'
import { STICKY_USER_BUBBLE_Z_INDEX } from '../src/client/features/sticky-user-bubble/model'

describe('sticky user bubble stacking', () => {
  it('stays under the official fullscreen sidebar overlay', () => {
    const sidebarNormal = 10
    const sidebarFullscreen = 40
    expect(STICKY_USER_BUBBLE_Z_INDEX).toBeGreaterThan(sidebarNormal)
    expect(STICKY_USER_BUBBLE_Z_INDEX).toBeLessThan(sidebarFullscreen)
  })
})
