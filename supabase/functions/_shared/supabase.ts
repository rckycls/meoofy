// Runtime wiring shared by the Edge Function entry points. The logic lives in the other _shared
// modules, which take their dependencies as arguments so `deno test` needs no network or server.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2'

/** The private bucket holding pet photos at {owner_id}/{pet_id}/{photo_id}.jpg. */
export const PHOTO_BUCKET = 'pet-photos'

/** A required environment variable (Supabase sets SUPABASE_URL and the keys for every function). */
export function env(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`missing environment variable ${name}`)
  return value
}

/**
 * A service-role client whose rpc calls go to the `api` schema: PostgREST exposes no other, so
 * the Edge Functions reach SQL only through the service_role-only api wrappers.
 */
export function serviceClient() {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    db: { schema: 'api' },
  })
}
