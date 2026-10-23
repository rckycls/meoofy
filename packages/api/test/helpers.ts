// Integration test helpers: talk to the local Supabase stack (`supabase start`). Defaults are the
// CLI's well-known local values; override them with the environment variables below.
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { SignJWT } from 'jose'
import pg from 'pg'
import { createPawpinClient, type PawpinClient } from '../src'
import type { Database } from '../src/database.types'

export const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
export const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const JWT_SECRET =
  process.env.SUPABASE_JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long'
const DB_URL =
  process.env.SUPABASE_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres'
const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324'

/** Service-role client. PostgREST exposes only `api`, so module schemas go through `sql`. */
export const admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
  db: { schema: 'api' },
  auth: { persistSession: false, autoRefreshToken: false },
})

/** A signed-out app client, as the app creates it. */
export function anonClient(): PawpinClient {
  return createPawpinClient({ url: SUPABASE_URL, anonKey: ANON_KEY })
}

/** A client that sends `token` as its access token, bypassing Auth (for crafted JWTs). */
export function clientWithAccessToken(token: string): PawpinClient {
  return createClient<Database>(SUPABASE_URL, ANON_KEY, {
    db: { schema: 'api' },
    accessToken: async () => token,
  })
}

/** Runs one statement as `postgres` over a direct connection (test helpers only). */
export async function sql(text: string, values: unknown[] = []): Promise<pg.QueryResult> {
  const client = new pg.Client({ connectionString: DB_URL })
  await client.connect()
  try {
    return await client.query(text, values)
  } finally {
    await client.end()
  }
}

/** Emails this test file touched; `cleanup` removes their users, allowlist and rejection rows. */
const touched = new Set<string>()

/** Marks an email for `cleanup` (lowercased, as Auth stores it). */
export function track(email: string): string {
  const normalized = email.toLowerCase()
  touched.add(normalized)
  return normalized
}

export function uniqueEmail(prefix = 'owner'): string {
  return `${prefix}-${randomUUID()}@pawpin.test`
}

/** Adds an email to the pilot allowlist, so the sign-up hook lets it through. */
export async function allowlist(email: string): Promise<string> {
  const normalized = track(email)
  await sql('insert into identity.pilot_allowlist (email) values ($1) on conflict do nothing', [
    normalized,
  ])
  return normalized
}

/**
 * A signed-in owner: allowlists the email, creates the user with the admin API (password,
 * confirmed email) and signs in with the password on a fresh app client.
 */
export async function newOwner(
  email: string = uniqueEmail(),
): Promise<{ client: PawpinClient; userId: string; email: string }> {
  const normalized = await allowlist(email)
  const password = `pw-${randomUUID()}`
  const { data, error } = await admin.auth.admin.createUser({
    email: normalized,
    password,
    email_confirm: true,
  })
  if (error) throw error
  const client = anonClient()
  const { error: signInError } = await client.auth.signInWithPassword({
    email: normalized,
    password,
  })
  if (signInError) throw signInError
  return { client, userId: data.user.id, email: normalized }
}

/** Deletes every user, allowlist entry and logged rejection for the emails this file touched. */
export async function cleanup(): Promise<void> {
  const emails = [...touched]
  touched.clear()
  if (emails.length === 0) return
  await sql('delete from auth.users where email = any($1)', [emails])
  await sql('delete from identity.pilot_allowlist where email = any($1)', [emails])
  await sql('delete from identity.signup_rejections where email = any($1)', [emails])
}

type MailpitSummary = { ID: string; To: { Address: string }[] }

/**
 * The 6-digit code in the newest Mailpit message to `email`. Polls for up to `timeoutMs`, since
 * Auth sends the email asynchronously.
 */
export async function latestEmailCode(email: string, timeoutMs = 10_000): Promise<string> {
  const target = email.toLowerCase()
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const list = (await (await fetch(`${MAILPIT_URL}/api/v1/messages`)).json()) as {
      messages: MailpitSummary[]
    }
    const newest = list.messages.find((m) => m.To.some((to) => to.Address.toLowerCase() === target))
    if (newest !== undefined) {
      const message = (await (
        await fetch(`${MAILPIT_URL}/api/v1/message/${newest.ID}`)
      ).json()) as { Text: string }
      const code = /\b(\d{6})\b/.exec(message.Text)?.[1]
      if (code !== undefined) return code
    }
    if (Date.now() > deadline) throw new Error(`no 6-digit code for ${email} in Mailpit`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

/**
 * An access token for `userId` signed with the local JWT secret, as Auth would issue it, that
 * expires `expiresIn` seconds from now (negative for one that has already expired).
 */
export async function signAccessToken(userId: string, expiresIn: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setAudience('authenticated')
    .setIssuedAt(Math.min(now, now + expiresIn) - 60)
    .setExpirationTime(now + expiresIn)
    .sign(new TextEncoder().encode(JWT_SECRET))
}
