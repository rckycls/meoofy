import { LIMITS } from './limits'

function assertWhole(value: number, name: string, max: number): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${name} must be a whole number from 0 to ${max}`)
  }
}

/** Converts the age form's years (0-30) and months (0-11) to `age_months` (0-360). */
export function toAgeMonths(years: number, months = 0): number {
  assertWhole(years, 'years', LIMITS.ageYearsMax)
  assertWhole(months, 'months', 11)
  const total = years * 12 + months
  if (total > LIMITS.ageMonthsMax) {
    throw new RangeError(`age must be at most ${LIMITS.ageMonthsMax} months`)
  }
  return total
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

/** Human-readable age such as "1 year 2 months"; `''` when the age is unknown. */
export function formatAge(ageMonths: number | null): string {
  if (ageMonths === null) return ''
  const years = Math.floor(ageMonths / 12)
  const months = ageMonths % 12
  if (years === 0) return plural(months, 'month')
  if (months === 0) return plural(years, 'year')
  return `${plural(years, 'year')} ${plural(months, 'month')}`
}
