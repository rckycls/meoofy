// What the tests do to the local stack's database. Only the `api` schema is exposed over HTTP, so
// the allowlist and clean-up go straight to Postgres. These are the local stack's well-known
// development credentials (`supabase start`); they reach nothing else.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

import pg from 'pg'

import { clearInbox } from './mailpit.ts'

const DB_URL =
  process.env.SUPABASE_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres'
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'

/** The workspace root, found from wherever the tests are run (they run from apps/app). */
function repoRoot(): string {
  let dir = process.cwd()
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir)
    if (parent === dir) throw new Error('No pnpm-workspace.yaml above ' + process.cwd())
    dir = parent
  }
  return dir
}

async function sql<Row extends pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<Row[]> {
  const client = new pg.Client({ connectionString: DB_URL })
  await client.connect()
  try {
    return (await client.query<Row>(text, values)).rows
  } finally {
    await client.end()
  }
}

/** Adds `email` to the pilot allowlist, so the sign-up hook lets it through. */
export async function allowlistOwner(email: string): Promise<void> {
  await sql('insert into identity.pilot_allowlist (email) values ($1) on conflict do nothing', [
    email.toLowerCase(),
  ])
}

let serviceKey: string | undefined

/**
 * The local stack's service-role key, read when it is needed: from SUPABASE_SERVICE_ROLE_KEY, or
 * from `supabase status`. It is never written down anywhere.
 */
function serviceRoleKey(): string {
  if (serviceKey !== undefined) return serviceKey
  const fromEnv = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (fromEnv) return (serviceKey = fromEnv)
  const status = execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'env'], {
    cwd: repoRoot(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const key = /^SERVICE_ROLE_KEY="?([^"\n]+)"?$/m.exec(status)?.[1]
  if (key === undefined) throw new Error('`supabase status` printed no SERVICE_ROLE_KEY')
  return (serviceKey = key)
}

/** Photo files go through Storage's API: it refuses direct deletes from storage.objects. */
async function removeFiles(names: string[]): Promise<void> {
  const key = serviceRoleKey()
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/pet-photos`, {
    method: 'DELETE',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ prefixes: names }),
  })
  if (!response.ok) throw new Error(`Storage answered ${response.status} deleting photo files`)
}

/**
 * Takes a test owner out of the local stack again: the user and everything that belongs to them,
 * the allowlist entry, and what is left of their photos. The database tests count the whole
 * deletion queue, so a run must not leave rows in it.
 *
 * Every step is tried whatever happened to the others (a Storage or CLI failure must not leave the
 * user and the allowlist entry behind). Failures are collected and reported together at the end,
 * so a failed clean-up is loud but never stops the rest of it.
 */
export async function removeOwner(email: string): Promise<void> {
  const address = email.toLowerCase()
  const failures: string[] = []
  async function attempt(what: string, step: () => Promise<unknown>): Promise<void> {
    try {
      await step()
    } catch (error) {
      failures.push(`${what}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  let owners: string[] = []
  await attempt('find the user', async () => {
    owners = (
      await sql<{ id: string }>('select id::text as id from auth.users where email = $1', [address])
    ).map((row) => row.id)
  })

  if (owners.length > 0) {
    await attempt('remove the photo files', async () => {
      const files = (
        await sql<{ name: string }>(
          `select name from storage.objects
            where bucket_id = 'pet-photos' and split_part(name, '/', 1) = any($1)`,
          [owners],
        )
      ).map((row) => row.name)
      if (files.length > 0) await removeFiles(files)
    })
    await attempt('delete the user', () =>
      sql('delete from auth.users where id::text = any($1)', [owners]),
    )
    // Deleting a user's pets queues their files; those files are already gone.
    await attempt('clear the deletion queue', () =>
      sql(
        `delete from registry.storage_deletions where split_part(storage_path, '/', 1) = any($1)`,
        [owners],
      ),
    )
  }
  await attempt('remove the allowlist entry', () =>
    sql('delete from identity.pilot_allowlist where email = $1', [address]),
  )
  await attempt('remove the sign-up rejections', () =>
    sql('delete from identity.signup_rejections where email = $1', [address]),
  )
  await attempt('clear the inbox', () => clearInbox(address))

  if (failures.length > 0) {
    throw new Error(`Cleaning up ${address} was incomplete:\n- ${failures.join('\n- ')}`)
  }
}
