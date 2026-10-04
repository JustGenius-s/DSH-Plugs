import { expect, test, vi } from 'vitest'
import { IconFlowOutline16 } from '@just-genius/dsh-plugin-ui'
import { createFlowArgumentSource, createFlowCommand } from '../src/client/command.ts'
import { zh, en, type FlowKey } from '../src/client/locales.ts'

const session = { sessionId: 'session-1' as never }
const signal = new AbortController().signal
const translate = (key: FlowKey) => zh[key]

test('the command has a live localized name and an outline icon', () => {
  let language: 'zh' | 'en' = 'zh'
  const run = vi.fn()
  const command = createFlowCommand(key => ({ zh, en })[language][key], run)
  expect(command.name).toBe('flow')
  expect(command.label()).toBe('流程')
  expect(command.icon).toBe(IconFlowOutline16)
  language = 'en'
  expect(command.label()).toBe('Flow')
  command.ui.run(session)
  expect(run).toHaveBeenCalledWith(session)
})

test.each(['/flow', '/流程'])('%s claims typed arguments and preserves their text until submit', async token => {
  const submit = vi.fn(async () => ({ kind: 'success' as const }))
  const source = createFlowArgumentSource(translate, submit)
  const result = source.matchSpace!(session, token)
  if (result === undefined || typeof result !== 'object' || !('claim' in result)) throw new Error('missing claim')
  expect(result.claim.token).toBe(`${token} `)
  expect(result.claim.hint).toBe(zh['command.hint'])
  expect(submit).not.toHaveBeenCalled()
  await result.claim.submit('  调整登录流程\n保留现有行为  ', {} as never, [])
  expect(submit).toHaveBeenCalledWith('session-1', '  调整登录流程\n保留现有行为  ')
  const entered = await source.matchEnter!(session, `${token} off`, signal, { images: 0 })
  expect(entered).toHaveProperty('claim.token', `${token} `)
})

test('arguments contribute no second menu row and leave bare /flow and other input alone', async () => {
  const submit = vi.fn()
  const source = createFlowArgumentSource(translate, submit)
  expect(await source.candidates(session, { query: '', position: 'leading', signal })).toEqual([])
  for (const line of ['/flow', '/flowchart off', '/debug off', 'hello /flow off']) {
    expect(await source.matchEnter!(session, line, signal, { images: 0 })).toBeUndefined()
  }
  expect(source.matchSpace!(session, '/flowchart')).toBeUndefined()
  expect(submit).not.toHaveBeenCalled()
})

test('typed /流程 can enter the mode and attachment-carrying submissions remain intact', async () => {
  const submit = vi.fn()
  const source = createFlowArgumentSource(translate, submit)
  expect(await source.matchEnter!(session, '/流程', signal, { images: 0 })).toHaveProperty('claim.token', '/流程 ')
  for (const envelope of [{ images: 1 }, { attachments: 1 }]) {
    await expect(source.matchEnter!(session, '/flow off', signal, envelope as never))
      .rejects.toThrow(zh['command.attachmentsUnsupported'])
  }
  expect(submit).not.toHaveBeenCalled()
})
