// Keeps the SQL limits in step with packages/core (LIMITS and petLimit). Run `pnpm gen:sql-limits`
// when the parity test in src/sqlLimits.test.ts fails.
//
// A migration that has shipped is never edited (Ruling 15): applied migrations don't run again on
// a hosted database. So this never overwrites a migration. It finds the newest migration that
// defines registry.limits(); if that one already matches packages/core it writes nothing, and
// otherwise it writes a NEW migration, `<UTC timestamp>_limits.sql`, that redefines the function
// (and brings the pet-photos bucket's size cap up to date). Commit it, then apply it with
// `supabase migration up` (locally) or `pnpm db:push` (hosted).
//
// Usage: node packages/core/scripts/emit-sql-limits.ts [migrations folder]
// The folder defaults to supabase/migrations; the tests pass a scratch one.
//
// Node runs this file directly (type stripping), so it uses only erasable syntax. Core's
// sources use extensionless relative imports (bundler style), which Node's resolver does not
// accept, so a resolve hook retries those specifiers with `.ts`.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

registerHooks({
  resolve(specifier, context, nextResolve) {
    const extensionless = specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)
    return nextResolve(extensionless ? `${specifier}.ts` : specifier, context)
  },
})

const {
  expectedLimitsMigrationSql,
  limitsUpdateMigrationSql,
  newestLimitsMigration,
  nextMigrationVersion,
} = await import('../src/sqlLimits.ts')

const folder = process.argv[2]
const migrationsDir =
  folder === undefined
    ? fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url))
    : resolve(folder)

const names = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()
const newest = newestLimitsMigration(
  names.map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), 'utf8') })),
)
if (newest === undefined) {
  throw new Error(`emit-sql-limits: no migration in ${migrationsDir} defines registry.limits()`)
}

if (newest.sql === expectedLimitsMigrationSql(newest.name)) {
  console.log(`emit-sql-limits: ${newest.name} already matches packages/core; nothing to write`)
} else {
  const target = join(migrationsDir, `${nextMigrationVersion(names, new Date())}_limits.sql`)
  // `wx` refuses to write over a file that exists: a migration is never overwritten.
  writeFileSync(target, limitsUpdateMigrationSql(), { flag: 'wx' })
  console.log(`emit-sql-limits: wrote ${target}`)
  console.log('Commit it, then apply it with `supabase migration up` (or `pnpm db:push`).')
}
