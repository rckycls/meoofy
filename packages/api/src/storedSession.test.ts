// readStoredSession says whose session this device keeps without asking Auth. Offline, supabase-js
// spends about 25 s retrying the refresh of an expired session and then reports no session at all,
// though the session is still stored and nobody has refused it; the app opens on that person's
// saved data meanwhile.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPawpinClient, readStoredSession, signOut, type SessionStorage } from './index'
import { offline, stubClient } from './testSupport'

const URL = 'http://stub.test'
/** Supabase's default key for that URL (`sb-<first host label>-auth-token`). */
const KEY = 'sb-stub-auth-token'
const USER_ID = '6f1c1d4e-1111-4222-8333-944455556666'
const ONE_HOUR = 3600

function storedSession({ expiresIn, email }: { expiresIn: number; email?: string }): string {
  return JSON.stringify({
    access_token: 'stored-access-token',
    token_type: 'bearer',
    expires_in: ONE_HOUR,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    refresh_token: 'stored-refresh-token',
    user: { id: USER_ID, aud: 'authenticated', ...(email === undefined ? {} : { email }) },
  })
}

/** A SessionStorage over a Map holding `items`, as the iOS secure store would. */
function memoryStorage(items: Record<string, string> = {}) {
  const map = new Map(Object.entries(items))
  const storage: SessionStorage = {
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => void map.set(key, value),
    removeItem: async (key) => void map.delete(key),
  }
  return { storage, map }
}

function clientWith(items: Record<string, string>) {
  return createPawpinClient({
    url: URL,
    anonKey: 'stub-anon-key',
    storage: memoryStorage(items).storage,
  })
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('readStoredSession', () => {
  it('names the person whose session is stored, without a request', async () => {
    const fetch = vi.fn(offline)
    vi.stubGlobal('fetch', fetch)
    const client = clientWith({ [KEY]: storedSession({ expiresIn: ONE_HOUR, email: 'a@b.test' }) })

    await expect(readStoredSession(client)).resolves.toEqual({ userId: USER_ID, email: 'a@b.test' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('still names them while supabase-js retries the refresh of an expired session offline', async () => {
    // Fake timers hold supabase-js's start-up refresh in its retry backoff for the whole test.
    vi.useFakeTimers()
    const fetch = vi.fn(offline)
    vi.stubGlobal('fetch', fetch)
    const client = clientWith({ [KEY]: storedSession({ expiresIn: -ONE_HOUR, email: 'a@b.test' }) })

    await expect(readStoredSession(client)).resolves.toEqual({ userId: USER_ID, email: 'a@b.test' })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    // The refresh is still failing, and the session is still the person's.
    await expect(readStoredSession(client)).resolves.toEqual({ userId: USER_ID, email: 'a@b.test' })
  })

  it('gives no email when the session carries none (Apple can hide it)', async () => {
    vi.stubGlobal('fetch', vi.fn(offline))
    const client = clientWith({ [KEY]: storedSession({ expiresIn: ONE_HOUR }) })

    await expect(readStoredSession(client)).resolves.toEqual({ userId: USER_ID, email: null })
  })

  it('is null when no session is stored', async () => {
    vi.stubGlobal('fetch', vi.fn(offline))

    await expect(readStoredSession(clientWith({}))).resolves.toBeNull()
  })

  it('is null, and never rejects, for a stored value it cannot read', async () => {
    vi.stubGlobal('fetch', vi.fn(offline))
    const unreadable = [
      'not json',
      'null',
      '"a string"',
      JSON.stringify({ access_token: 'a', expires_at: 1, user: { id: USER_ID } }),
      JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: 1, user: {} }),
      JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: 1, user: { id: 7 } }),
    ]
    for (const value of unreadable) {
      await expect(readStoredSession(clientWith({ [KEY]: value }))).resolves.toBeNull()
    }

    let locked = false
    const flaky = createPawpinClient({
      url: URL,
      anonKey: 'stub-anon-key',
      storage: {
        getItem: async () => {
          if (locked) throw new Error('keychain locked')
          return storedSession({ expiresIn: ONE_HOUR })
        },
        setItem: async () => undefined,
        removeItem: async () => undefined,
      },
    })
    // Let supabase-js finish its own start-up reads before the store starts failing.
    await flaky.auth.getSession()
    await flaky.auth.stopAutoRefresh()
    locked = true
    await expect(readStoredSession(flaky)).resolves.toBeNull()
  })

  it('is null once the person has signed out on this device', async () => {
    vi.stubGlobal('fetch', vi.fn(offline))
    const client = clientWith({ [KEY]: storedSession({ expiresIn: ONE_HOUR }) })
    await expect(readStoredSession(client)).resolves.not.toBeNull()

    // Offline, the revoke request fails, but the session is forgotten anyway.
    await signOut(client).catch(() => undefined)

    await expect(readStoredSession(client)).resolves.toBeNull()
  })

  it('is null for a client this package did not make', async () => {
    await expect(readStoredSession(stubClient(offline))).resolves.toBeNull()
  })
})
