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
      // Sign-in is by email code or Apple id token, never a redirect back with tokens in the URL.
      detectSessionInUrl: false,
    },
  })
}
