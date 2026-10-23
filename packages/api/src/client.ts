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

export function createPawpinClient(opts: PawpinClientOptions): PawpinClient {
  return createClient<Database>(opts.url, opts.anonKey, {
    // `api` is the only schema PostgREST exposes. Its built-in retry is off: the app's query layer
    // owns retries (network failures up to 3 times), so reads are not retried twice over.
    db: { schema: 'api', retry: false },
    auth: {
      ...(opts.storage !== undefined && { storage: opts.storage }),
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
}
