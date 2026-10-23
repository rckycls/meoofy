// The Mailpit helper's promise, checked on its own with messages put into Mailpit directly: a code
// that was already in the inbox when `codeAfter` began is never returned, however it got there and
// whether or not anything read it. No browser is involved, so it runs for one project only.
import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { clearInbox, codeAfter } from '../support/mailpit'

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

test('returns the code of the message that the send produced', async () => {
  expect(await codeAfter(address, () => deliver(address, '111111'))).toBe('111111')
})

test('never returns an earlier message nothing has read, when the send lands late', async () => {
  // The first email arrived and was never read (the case of a resend after a refused code).
  await deliver(address, '111111')

  // The second send returns at once; its email lands a moment after the helper starts polling.
  const code = await codeAfter(address, async () => {
    setTimeout(() => void deliver(address, '222222'), 400)
  })

  expect(code).toBe('222222')
})

test('gives up, rather than return an earlier message, when nothing new arrives', async () => {
  await deliver(address, '111111')

  await expect(codeAfter(address, async () => undefined, 1_000)).rejects.toThrow(
    /No new 6-digit code/,
  )
})

test('reads one code after another, each only from its own send', async () => {
  const first = await codeAfter(address, () => deliver(address, '111111'))
  const second = await codeAfter(address, () => deliver(address, '222222'))
  const third = await codeAfter(address, async () => {
    setTimeout(() => void deliver(address, '333333'), 300)
  })

  expect([first, second, third]).toEqual(['111111', '222222', '333333'])
})

test('waits for the send to finish before it looks, and takes the newest if two arrive', async () => {
  const code = await codeAfter(address, async () => {
    await deliver(address, '444444')
    await deliver(address, '555555')
  })

  expect(code).toBe('555555')
})
