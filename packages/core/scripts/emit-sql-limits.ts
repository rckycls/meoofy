// Writes supabase/migrations/20261023000000_limits.sql from the limits in packages/core.
// Run with `pnpm gen:sql-limits`; the parity test in src/sqlLimits.test.ts fails until you do.
//
// Node runs this file directly (type stripping), so it uses only erasable syntax. Core's
// sources use extensionless relative imports (bundler style), which Node's resolver does not
// accept, so a resolve hook retries those specifiers with `.ts`.
import { writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

registerHooks({
  resolve(specifier, context, nextResolve) {
    const extensionless = specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)
    return nextResolve(extensionless ? `${specifier}.ts` : specifier, context)
  },
})

const { limitsMigrationSql } = await import('../src/sqlLimits.ts')

const TARGET = fileURLToPath(
  new URL('../../../supabase/migrations/20261023000000_limits.sql', import.meta.url),
)

writeFileSync(TARGET, limitsMigrationSql())
console.log(`emit-sql-limits: wrote ${TARGET}`)
