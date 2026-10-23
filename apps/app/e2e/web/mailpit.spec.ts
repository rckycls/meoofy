// The Mailpit helper's promise, checked on its own with messages put into Mailpit directly: a code
// that was already in the inbox when the mark was taken is never returned, and a message is used
// once. No browser is involved, so it runs for one project only.
import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { clearInbox, latestCode, markInbox } from '../support/mailpit'

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324'

async function deliver(to: string, code: string) {
  const response = await fetch(`${MAILPIT_URL}/api/v1/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      From: { Email: 'noreply@pawpin.test' },
      To: [{ Email: to }],
      Subject: 'Your PawPin sign-in code',
      Text: `Enter this code in PawPin to sign in:\n\n${code}\n`,
    }),
  })
  expect(response.ok).toBe(true)
}

let address = ''

test.beforeEach(async () => {
  test.skip(test.info().project.name !== 'mobile-390', 'No browser here: once is enough.')
  address = `helper-check+${randomUUID().slice(0, 8)}@pawpin.test`
  await clearInbox(address)
})

test.afterEach(async () => {
  await clearInbox(address)
})

test('never returns a code that was in the inbox when it was marked', async () => {
  await deliver(address, '111111')
  const mark = await markInbox(address)

  // Only the old message is there: not a candidate, however long it has been waiting.
  await expect(latestCode(address, mark, 1_000)).rejects.toThrow(/No new 6-digit code/)

  await deliver(address, '222222')
  expect(await latestCode(address, mark)).toBe('222222')
})

test('waits for a code that arrives after the mark, then returns the newest', async () => {
  await deliver(address, '111111')
  const mark = await markInbox(address)

  const pending = latestCode(address, mark)
  await deliver(address, '333333')

  expect(await pending).toBe('333333')
})

test('uses a message once, even with a mark taken too early', async () => {
  const early = await markInbox(address)
  await deliver(address, '444444')
  expect(await latestCode(address, early)).toBe('444444')

  // The same mark again: the first message is not handed out a second time.
  await expect(latestCode(address, early, 1_000)).rejects.toThrow(/No new 6-digit code/)
  await deliver(address, '555555')
  expect(await latestCode(address, early)).toBe('555555')
})

test('refuses a mark for another address', async () => {
  const mark = await markInbox('someone-else@pawpin.test')
  await expect(latestCode(address, mark, 500)).rejects.toThrow(/inbox mark is for/)
})
