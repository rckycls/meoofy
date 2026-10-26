import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { LIMITS } from './limits'
import {
  FIRST_LIMITS_MIGRATION,
  expectedLimitsMigrationSql,
  limitsMigrationSql,
  limitsUpdateMigrationSql,
  newestLimitsMigration,
  nextMigrationVersion,
  sqlLimits,
  type Migration,
} from './sqlLimits'

const MIGRATIONS = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url))
const EMITTER = fileURLToPath(new URL('../scripts/emit-sql-limits.ts', import.meta.url))

/** Every migration in `dir`, in the order Supabase applies them. */
function readMigrations(dir: string): Migration[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }))
}

const jsonIn = (sql: string): unknown => {
  const match = sql.match(/'(\{.*\})'::jsonb/s)
  expect(match, 'no jsonb literal in the limits migration').not.toBeNull()
  return JSON.parse(match![1]!)
}

describe('sqlLimits', () => {
  it('maps every LIMITS value plus the tier pet limits', () => {
    expect(sqlLimits()).toEqual({
      ...LIMITS,
      tierLimits: { free: 3, pro: 10, max: null },
    })
    expect(sqlLimits()).toMatchObject({
      petNameMax: 40,
      breedMax: 80,
      ageMonthsMax: 360,
      photosPerPet: 6,
      photoMaxBytes: 4194304,
      photoMinShortSide: 720,
      uploadsPerHour: 30,
      tierLimits: { free: 3, pro: 10, max: null },
    })
  })
})

describe('the newest migration that defines registry.limits()', () => {
  const newest = () => {
    const found = newestLimitsMigration(readMigrations(MIGRATIONS))
    expect(found, 'no migration defines registry.limits()').toBeDefined()
    return found!
  }

  it('is the first limits migration, while LIMITS have not changed since it shipped', () => {
    expect(newest().name).toBe(FIRST_LIMITS_MIGRATION)
  })

  it('holds the same JSON registry.limits() returns', () => {
    expect(jsonIn(newest().sql)).toEqual(sqlLimits())
  })

  it('is exactly what `pnpm gen:sql-limits` writes', () => {
    // Fails when LIMITS or petLimit change: run `pnpm gen:sql-limits`, which adds a new migration.
    expect(newest().sql).toBe(expectedLimitsMigrationSql(newest().name))
  })
})

describe('newestLimitsMigration', () => {
  it('picks the last migration, in apply order, that defines registry.limits()', () => {
    const found = newestLimitsMigration([
      { name: '20261023000000_limits.sql', sql: limitsMigrationSql() },
      { name: '20261101090000_limits.sql', sql: limitsUpdateMigrationSql() },
      { name: '20261102090000_other.sql', sql: 'select 1;' },
    ])

    expect(found?.name).toBe('20261101090000_limits.sql')
  })

  it('ignores migrations that only call registry.limits()', () => {
    const found = newestLimitsMigration([
      { name: '20261023000000_limits.sql', sql: limitsMigrationSql() },
      {
        name: '20261023000006_photo_api.sql',
        sql: "select (registry.limits() ->> 'photoMaxBytes')::bigint;",
      },
    ])

    expect(found?.name).toBe('20261023000000_limits.sql')
  })

  it('finds nothing when no migration defines it', () => {
    expect(newestLimitsMigration([{ name: '1_x.sql', sql: 'select 1;' }])).toBeUndefined()
  })
})

describe('limitsUpdateMigrationSql', () => {
  it('redefines registry.limits() as the first migration defines it, with the current JSON', () => {
    const sql = limitsUpdateMigrationSql()

    expect(jsonIn(sql)).toEqual(sqlLimits())
    expect(sql).toContain(
      "create or replace function registry.limits()\nreturns jsonb\nlanguage sql\nimmutable\nparallel safe\nset search_path = ''",
    )
    expect(sql).toContain('comment on function registry.limits() is')
  })

  it('brings the pet-photos bucket size cap up to date, which 0006 read from the old limits', () => {
    expect(limitsUpdateMigrationSql()).toContain(
      "update storage.buckets\n   set file_size_limit = (registry.limits() ->> 'photoMaxBytes')::bigint\n where id = 'pet-photos';",
    )
  })
})

describe('nextMigrationVersion', () => {
  it('is the current UTC time as YYYYMMDDHHMMSS', () => {
    expect(
      nextMigrationVersion(
        ['20261023000010_photo_reuse_and_cap.sql'],
        new Date('2026-11-02T09:05:07Z'),
      ),
    ).toBe('20261102090507')
  })

  it('comes after the newest migration even when the clock does not', () => {
    expect(
      nextMigrationVersion(
        ['20261023000010_photo_reuse_and_cap.sql'],
        new Date('2026-10-23T00:00:05Z'),
      ),
    ).toBe('20261023000011')
  })
})

describe('pnpm gen:sql-limits', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  const LATER = '20261023000010_photo_reuse_and_cap.sql'

  /** A migrations folder holding a first limits migration (as `edit` leaves it) and a later one. */
  function migrationsWith(edit: (sql: string) => string): string {
    const dir = mkdtempSync(join(tmpdir(), 'meoofy-limits-'))
    dirs.push(dir)
    writeFileSync(join(dir, FIRST_LIMITS_MIGRATION), edit(limitsMigrationSql()))
    writeFileSync(join(dir, LATER), 'select 1;\n')
    return dir
  }

  const emit = (dir: string) => spawnSync(process.execPath, [EMITTER, dir], { encoding: 'utf8' })

  it('never rewrites a shipped migration: a limits change becomes a new migration', () => {
    const stale = limitsMigrationSql().replace('"photosPerPet": 6', '"photosPerPet": 5')
    const dir = migrationsWith(() => stale)

    const run = emit(dir)

    expect(run.status, run.stderr).toBe(0)
    expect(readFileSync(join(dir, FIRST_LIMITS_MIGRATION), 'utf8')).toBe(stale)
    const added = readdirSync(dir).filter((name) => ![FIRST_LIMITS_MIGRATION, LATER].includes(name))
    expect(added).toHaveLength(1)
    expect(added[0]).toMatch(/^\d{14}_limits\.sql$/)
    expect(added[0]! > LATER).toBe(true)
    expect(readFileSync(join(dir, added[0]!), 'utf8')).toBe(limitsUpdateMigrationSql())

    // The new migration is now the newest definition and it matches, so a second run adds nothing.
    const again = emit(dir)
    expect(again.status, again.stderr).toBe(0)
    expect(readdirSync(dir)).toHaveLength(3)
  })

  it('writes nothing when the newest definition already matches', () => {
    const dir = migrationsWith((sql) => sql)

    const run = emit(dir)

    expect(run.status, run.stderr).toBe(0)
    expect(readdirSync(dir).sort()).toEqual([FIRST_LIMITS_MIGRATION, LATER])
  })
})
