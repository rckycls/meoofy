// Unit-test helpers: a client whose every request goes to a stub `fetch`, so the real supabase-js
// libraries produce their real error shapes without a network.
import { createClient } from '@supabase/supabase-js'
import type { MeoofyClient } from './client'
import type { Database } from './database.types'

export type Fetch = typeof globalThis.fetch

export function stubClient(fetch: Fetch): MeoofyClient {
  return createClient<Database>('http://stub.test', 'stub-anon-key', {
    db: { schema: 'api', retry: false },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch },
  })
}

/** A fetch that fails the way Node's does when the server is unreachable. */
export const offline: Fetch = async () => {
  throw new TypeError('fetch failed')
}

/** A fetch that always answers `status` with `body` as JSON, or with no body and no type for 204. */
export function respond(status: number, body?: unknown): Fetch {
  return async () =>
    status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        })
}

const STUB_SESSION_KEY = 'sb-stub-auth-token'

/**
 * A client with a stored session (as after a sign-in) whose access token expires `expiresIn`
 * seconds from now (negative: already expired), and whose requests go to the stub `fetch`.
 * `stored()` reads the session back, to see whether supabase-js kept it.
 */
export function signedInStubClient(fetch: Fetch, { expiresIn }: { expiresIn: number }) {
  const storage = new Map<string, string>()
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn
  storage.set(
    STUB_SESSION_KEY,
    JSON.stringify({
      access_token: 'stub-access-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: expiresAt,
      refresh_token: 'stub-refresh-token',
      user: { id: '6f1c1d4e-1111-4222-8333-944455556666', aud: 'authenticated' },
    }),
  )
  const client = createClient<Database>('http://stub.test', 'stub-anon-key', {
    db: { schema: 'api', retry: false },
    auth: {
      storageKey: STUB_SESSION_KEY,
      storage: {
        getItem: async (key) => storage.get(key) ?? null,
        setItem: async (key, value) => void storage.set(key, value),
        removeItem: async (key) => void storage.delete(key),
      },
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch },
  })
  return { client, stored: () => storage.get(STUB_SESSION_KEY) ?? null }
}

/** A refresh-token grant response carrying a new session. */
export const refreshed: Fetch = async () =>
  new Response(
    JSON.stringify({
      access_token: 'new-access-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'new-refresh-token',
      user: { id: '6f1c1d4e-1111-4222-8333-944455556666', aud: 'authenticated' },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
