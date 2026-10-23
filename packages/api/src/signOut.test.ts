// Signing out must forget the session on this device in every state the app can be in. supabase-js
// forgets it itself, even when the revoke request fails, except when it can't load the session: an
// expired access token whose refresh fails (offline, or Auth down). It then returns the error and
// keeps the session, which would come back on the next start and refresh into a full session once
// Auth can be reached. These run the real supabase-js over a stub fetch.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createPawpinClient,
  deleteAccount,
  forgetSession,
  onSessionForgotten,
  readStoredSession,
  signOut,
  type PawpinClient,
} from './index'
import { offline, refreshed, type Fetch } from './testSupport'

const URL = 'http://stub.test'
const KEY = 'sb-stub-auth-token'
const ONE_HOUR = 3600

function storedSession(expiresIn: number): string {
  return JSON.stringify({
    access_token: 'stored-access-token',
    token_type: 'bearer',
    expires_in: ONE_HOUR,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    refresh_token: 'stored-refresh-token',
    user: { id: '6f1c1d4e-1111-4222-8333-944455556666', aud: 'authenticated' },
  })
}

/** A client made the app's way, with `session` stored, whose requests go to `fetch`. */
function signedIn(session: string, fetch: Fetch) {
  vi.stubGlobal('fetch', fetch)
  const map = new Map([[KEY, session]])
  const client = createPawpinClient({
    url: URL,
    anonKey: 'stub-anon-key',
    storage: {
      getItem: async (key) => map.get(key) ?? null,
      setItem: async (key, value) => void map.set(key, value),
      removeItem: async (key) => void map.delete(key),
    },
  })
  const forgotten = vi.fn()
  onSessionForgotten(client, forgotten)
  return { client, stored: () => map.get(KEY) ?? null, forgotten }
}

/** Runs supabase-js's refresh retries (about 25 s offline) and one auto-refresh tick. */
async function letSupabaseRetry() {
  await vi.advanceTimersByTimeAsync(31_000)
}

async function signOutSettled(client: PawpinClient) {
  const outcome = signOut(client).then(
    () => 'resolved',
    (error: unknown) => error,
  )
  await letSupabaseRetry()
  return outcome
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('signOut', () => {
  it('forgets an expired session that supabase-js cannot refresh offline', async () => {
    vi.useFakeTimers()
    const { client, stored, forgotten } = signedIn(storedSession(-ONE_HOUR), vi.fn(offline))

    expect(await signOutSettled(client)).toBe('resolved')

    expect(stored()).toBeNull()
    expect(forgotten).toHaveBeenCalledTimes(1)
    await expect(readStoredSession(client)).resolves.toBeNull()
  })

  it('forgets a session whose revoke request fails offline, as supabase-js does', async () => {
    const { client, stored } = signedIn(storedSession(ONE_HOUR), vi.fn(offline))

    await expect(signOut(client)).resolves.toBeUndefined()

    expect(stored()).toBeNull()
  })
})

describe('forgetSession', () => {
  it('forgets the session at once, without waiting for supabase-js to give up refreshing', async () => {
    // Fake timers hold supabase-js's start-up refresh in its retry backoff.
    vi.useFakeTimers()
    const fetch = vi.fn(offline)
    const { client, stored, forgotten } = signedIn(storedSession(-ONE_HOUR), fetch)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())

    await forgetSession(client)

    expect(stored()).toBeNull()
    expect(forgotten).toHaveBeenCalledTimes(1)
  })

  it('keeps it forgotten when the refresh that was under way succeeds later', async () => {
    vi.useFakeTimers()
    let reachable = false
    let refreshedAfterForget = 0
    const fetch = vi.fn<Fetch>((...args) => {
      if (!reachable) return offline(...args)
      refreshedAfterForget += 1
      return refreshed(...args)
    })
    const { client, stored } = signedIn(storedSession(-ONE_HOUR), fetch)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())

    await forgetSession(client)
    reachable = true
    await letSupabaseRetry()

    // Auth answered the refresh that started before the session was forgotten, with new tokens.
    expect(refreshedAfterForget).toBeGreaterThan(0)
    expect(stored()).toBeNull()
    const { data } = await client.auth.getSession()
    expect(data.session).toBeNull()
  })

  it('stops telling a listener once it unsubscribes', async () => {
    const { client } = signedIn(storedSession(ONE_HOUR), vi.fn(offline))
    const listener = vi.fn()
    const stop = onSessionForgotten(client, listener)

    stop()
    await forgetSession(client)

    expect(listener).not.toHaveBeenCalled()
  })
})

describe('deleteAccount', () => {
  it('forgets the session after the deletion even when supabase-js cannot refresh it', async () => {
    vi.useFakeTimers()
    // The function answers; Auth can't be reached to refresh or revoke.
    const fetch = vi.fn<Fetch>(async (input) =>
      String(input).includes('/functions/v1/delete-account')
        ? new Response(null, { status: 204 })
        : offline(input),
    )
    const { client, stored } = signedIn(storedSession(-ONE_HOUR), fetch)

    const outcome = deleteAccount(client).then(() => 'resolved')
    await letSupabaseRetry()
    await letSupabaseRetry()

    expect(await outcome).toBe('resolved')
    expect(stored()).toBeNull()
  })
})
