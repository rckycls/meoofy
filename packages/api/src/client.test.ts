// The web build signs in with Apple through a redirect back to the app, so it must read the
// session from the URL it returns to; every other sign-in path must leave the URL alone.
import { describe, expect, it } from 'vitest'
import { createPawpinClient, type PawpinClient } from './index'

const detectsSessionInUrl = (c: PawpinClient) =>
  (c.auth as unknown as { detectSessionInUrl: unknown }).detectSessionInUrl

const base = { url: 'http://stub.test', anonKey: 'stub-anon-key' }

describe('createPawpinClient', () => {
  it('ignores the URL by default (email code and Apple id token sign-in never redirect back)', () => {
    expect(detectsSessionInUrl(createPawpinClient(base))).toBe(false)
  })

  it('reads the session from the URL when asked to (the web Apple redirect)', () => {
    expect(detectsSessionInUrl(createPawpinClient({ ...base, detectSessionInUrl: true }))).toBe(
      true,
    )
  })
})
