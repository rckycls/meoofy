// Integration test helpers: talk to the local Supabase stack (`supabase start`). Defaults are the
// CLI's well-known local values; override them with the environment variables below.
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { SignJWT } from 'jose'
import jpeg from 'jpeg-js'
import pg from 'pg'
import { createMeoofyClient, type MeoofyClient } from '../src'
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
export function anonClient(): MeoofyClient {
  return createMeoofyClient({ url: SUPABASE_URL, anonKey: ANON_KEY })
}

/** A client that sends `token` as its access token, bypassing Auth (for crafted JWTs). */
export function clientWithAccessToken(token: string): MeoofyClient {
  return createClient<Database>(SUPABASE_URL, ANON_KEY, {
    db: { schema: 'api' },
    accessToken: async () => token,
  })
}

/** Runs one statement as `postgres` over a direct connection (test helpers only). */
export async function sql<Row extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<pg.QueryResult<Row>> {
  const client = new pg.Client({ connectionString: DB_URL })
  await client.connect()
  try {
    return await client.query<Row>(text, values)
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
  return `${prefix}-${randomUUID()}@meoofy.test`
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
): Promise<{ client: MeoofyClient; userId: string; email: string }> {
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

/**
 * Deletes every user, allowlist entry and logged rejection for the emails this file touched,
 * plus the photo files those users uploaded and the queued deletions of their paths, so the next
 * run (and pgTAP's cleanup tests, which count the whole queue) start from a clean bucket.
 */
export async function cleanup(): Promise<void> {
  const emails = [...touched]
  touched.clear()
  if (emails.length === 0) return
  const { rows: users } = await sql<{ id: string }>(
    'select id::text as id from auth.users where email = any($1)',
    [emails],
  )
  const owners = users.map((u) => u.id)
  if (owners.length > 0) {
    // Files are under {owner_id}/. Storage refuses direct deletes from storage.objects, so they
    // go through its API.
    const { rows: files } = await sql<{ name: string }>(
      `select name from storage.objects
        where bucket_id = 'pet-photos' and split_part(name, '/', 1) = any($1)`,
      [owners],
    )
    if (files.length > 0) {
      const { error } = await admin.storage.from('pet-photos').remove(files.map((f) => f.name))
      if (error) throw error
    }
    await sql(
      `delete from registry.storage_deletions where split_part(storage_path, '/', 1) = any($1)`,
      [owners],
    )
  }
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

/** How many paths under `{ownerId}/{petId}/` wait in registry.storage_deletions. */
export async function queuedPaths(ownerId: string, petId: string): Promise<number> {
  const { rows } = await sql<{ n: number }>(
    'select count(*)::int as n from registry.storage_deletions where storage_path like $1',
    [`${ownerId}/${petId}/%`],
  )
  return rows[0]!.n
}

/** mulberry32: a small seeded PRNG, so test images are the same on every run and machine. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Side of the flat squares the test image is made of, in pixels (one JPEG block). */
const TILE = 8

/**
 * A deterministic, high-texture `width`×`height` JPEG (jpeg-js, quality 80): 8×8 squares of
 * pseudo-random grey between 48 and 208, chosen by `seed`. The same arguments always give the
 * same bytes. Its grayscale copy has a mean brightness near 128 and a blur score far above
 * LIMITS.blurMin, so it passes `assessPhoto` whenever its short side is at least
 * LIMITS.photoMinShortSide. Squares that line up with JPEG's 8×8 blocks keep a 1600×1200 image
 * small (tens of kilobytes), well under LIMITS.photoMaxBytes.
 */
export function makeTestJpeg(width: number, height: number, seed = 1): ArrayBuffer {
  const random = seededRandom(seed)
  const columns = Math.ceil(width / TILE)
  const rows = Math.ceil(height / TILE)
  const shades = Array.from({ length: columns * rows }, () => 48 + Math.floor(random() * 161))
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const shade = shades[Math.floor(y / TILE) * columns + Math.floor(x / TILE)]!
      const i = (y * width + x) * 4
      rgba[i] = shade
      rgba[i + 1] = shade
      rgba[i + 2] = shade
      rgba[i + 3] = 255
    }
  }
  const { data } = jpeg.encode({ data: rgba, width, height }, 80)
  return Uint8Array.from(data).buffer
}
