// Unit-test helpers: a client whose every request goes to a stub `fetch`, so the real supabase-js
// libraries produce their real error shapes without a network.
import { createClient } from '@supabase/supabase-js'
import type { PawpinClient } from './client'
import type { Database } from './database.types'

export type Fetch = typeof globalThis.fetch

export function stubClient(fetch: Fetch): PawpinClient {
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
