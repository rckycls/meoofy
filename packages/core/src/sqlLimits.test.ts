import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LIMITS } from './limits'
import { limitsMigrationSql, sqlLimits } from './sqlLimits'

const MIGRATION = new URL('../../../supabase/migrations/20261023000000_limits.sql', import.meta.url)

const readMigration = () => readFileSync(MIGRATION, 'utf8')

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

describe('generated SQL limits migration', () => {
  it('holds the same JSON registry.limits() returns', () => {
    const match = readMigration().match(/'(\{.*\})'::jsonb/s)
    expect(match, 'no jsonb literal in the limits migration').not.toBeNull()
    expect(JSON.parse(match![1]!)).toEqual(sqlLimits())
  })

  it('is exactly what `pnpm gen:sql-limits` writes', () => {
    // Fails when LIMITS or petLimit change without regenerating the migration.
    expect(readMigration()).toBe(limitsMigrationSql())
  })
})
