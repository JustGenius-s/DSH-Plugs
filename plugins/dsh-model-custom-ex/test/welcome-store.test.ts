import { describe, expect, it } from 'vitest'
import { createSnapshotStore, getSettingsScope } from '@just-genius/dsh-plugin-runtime/client'
import { createWelcomeNoticeStore } from '../src/client/welcome-store'
import { WELCOME_NOTICE_VERSION } from '../src/onboarding-copy'

function settingsFixture(service: 'configForms' | 'settingsScope', servedNamespace: string) {
  let saved: Record<string, unknown> = {}
  const writes: string[] = []
  const bind = (namespace: string) => {
    const available = namespace === servedNamespace
    const store = createSnapshotStore({
      status: available ? 'ready' : 'unavailable',
      value: available ? saved : undefined,
      base: {}, user: {}, revision: 1, writable: true, mode: 'host',
    })
    return {
      getSnapshot: () => store.getSnapshot(),
      subscribe: (listener: () => void) => store.subscribe(listener),
      async set(field: string, value: unknown) {
        if (!available) return false
        writes.push(namespace)
        saved = { ...saved, [field]: value }
        store.update(snapshot => { snapshot.value = saved; snapshot.revision += 1 })
        return true
      },
    }
  }
  const provider = service === 'configForms'
    ? { get: bind }
    : { bind: (spec: { namespace: string }) => bind(spec.namespace) }
  const settings = getSettingsScope({
    get: (name: string) => name === service ? provider : undefined,
    effect: () => () => {},
  } as never)
  return { settings, writes, saved: () => saved }
}

describe('welcome acknowledgement settings', () => {
  it.each([
    ['configForms', 'ui-settings-general'],
    ['settingsScope', 'ui-onboarding'],
  ] as const)('persists through %s and stays acknowledged on reopening', async (service, namespace) => {
    const fixture = settingsFixture(service, namespace)
    const welcome = createWelcomeNoticeStore(fixture.settings)
    await welcome.load()
    expect(welcome.store.getSnapshot()).toMatchObject({ status: 'ready', acknowledged: false, error: null })
    expect(await welcome.acknowledge()).toBe(true)
    expect(fixture.writes).toEqual([namespace])
    expect(fixture.saved()).toEqual({ welcomeNoticeVersion: WELCOME_NOTICE_VERSION })
    expect(welcome.store.getSnapshot().acknowledged).toBe(true)
    welcome.dispose()

    const reopened = createWelcomeNoticeStore(fixture.settings)
    await reopened.load()
    expect(reopened.store.getSnapshot()).toMatchObject({ status: 'ready', acknowledged: true, error: null })
    reopened.dispose()
  })

  it('keeps the notice unacknowledged when the Host refuses an unavailable namespace', async () => {
    const fixture = settingsFixture('configForms', 'unrelated-settings')
    const welcome = createWelcomeNoticeStore(fixture.settings)
    await welcome.load()
    expect(await welcome.acknowledge()).toBe(false)
    expect(welcome.store.getSnapshot()).toMatchObject({ status: 'error', acknowledged: false })
    expect(fixture.writes).toEqual([])
    welcome.dispose()
  })
})
