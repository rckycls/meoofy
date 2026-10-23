import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

/** The app's Supabase client. Only `@pawpin/api` touches it; screens call this package instead. */
export type PawpinClient = SupabaseClient<Database>

/** Where the session is kept: expo-secure-store on iOS; omitted on web (Supabase's default). */
export type SessionStorage = {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

export type PawpinClientOptions = {
  url: string
  anonKey: string
  storage?: SessionStorage
  /**
   * Read a session from the URL the page was opened with. The web build needs it to finish Sign
   * in with Apple, which redirects back with the session; leave it off everywhere else. Turning it
   * on also switches the client to the PKCE flow: the redirect then carries a one-time `?code=`
   * that only the browser which started the sign-in (it holds the code verifier) can exchange. The
   * default implicit flow takes whatever `#access_token=` fragment a page is opened with, so a
   * crafted link could sign a person into someone else's account.
   */
  detectSessionInUrl?: boolean
}

/** Reads a stored session back: the iOS secure store, or the browser's localStorage. */
type SessionReader = { getItem(key: string): string | null | Promise<string | null> }

/** Where each client made here keeps its session, so `readStoredSession` can read it back. */
const sessionStores = new WeakMap<PawpinClient, { storage: SessionReader; key: string }>()

/** Where a client made by `createPawpinClient` keeps its session; `undefined` for any other. */
export function sessionStoreOf(
  c: PawpinClient,
): { storage: SessionReader; key: string } | undefined {
  return sessionStores.get(c)
}

/**
 * What supabase-js uses when it is given no storage: the browser's localStorage, where there is
 * one it may use. Without it (server rendering, a blocked localStorage) the session lives in
 * memory and nothing can be read back.
 */
function browserStorage(): SessionReader | undefined {
  const { window, document } = globalThis as {
    window?: { localStorage?: SessionReader }
    document?: unknown
  }
  if (window === undefined || document === undefined) return undefined
  try {
    return window.localStorage
  } catch {
    // Reading `localStorage` throws when the browser blocks site data.
    return undefined
  }
}

export function createPawpinClient(opts: PawpinClientOptions): PawpinClient {
  // Supabase's own default key, given explicitly so the session can be read back from it (and a
  // session stored before this was set keeps working).
  const storageKey = `sb-${new URL(opts.url).hostname.split('.')[0]}-auth-token`
  const client = createClient<Database>(opts.url, opts.anonKey, {
    // `api` is the only schema PostgREST exposes. Its built-in retry is off: the app's query layer
    // owns retries (network failures up to 3 times), so reads are not retried twice over.
    db: { schema: 'api', retry: false },
    auth: {
      ...(opts.storage !== undefined && { storage: opts.storage }),
      storageKey,
      persistSession: true,
      autoRefreshToken: true,
      // Email code and Apple id token sign-in never redirect back with tokens in the URL; only
      // the web's Apple redirect does, and it asks for this. PKCE goes with it (see the option):
      // an implicit-style fragment is then refused, and a `?code=` needs this browser's verifier.
      // Email codes still work: `verifyOtp` takes the 6-digit code and needs no verifier.
      detectSessionInUrl: opts.detectSessionInUrl ?? false,
      ...(opts.detectSessionInUrl === true && { flowType: 'pkce' as const }),
    },
  })
  const storage = opts.storage ?? browserStorage()
  if (storage !== undefined) sessionStores.set(client, { storage, key: storageKey })
  return client
}
