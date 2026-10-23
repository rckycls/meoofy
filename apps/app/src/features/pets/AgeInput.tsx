import { StyleSheet, Text, View } from 'react-native'
import { LIMITS, toAgeMonths } from '@pawpin/core'
import { Field, colors, space, textStyle, type } from '@pawpin/ui'

import { petsCopy } from './copy'

const copy = petsCopy

/** What is wrong with the age fields, one message per field. */
export type AgeErrors = { years?: string; months?: string }

export type AgeResult = { ok: true; ageMonths: number | null } | { ok: false; errors: AgeErrors }

const WHOLE_NUMBER = /^\d+$/

/**
 * Reads the two age fields as `age_months`. Both empty means the age is not known. Empty years
 * with months filled in counts as 0 years, so a puppy can be "6 months" without typing a zero.
 * The limits are core's: `toAgeMonths` is what decides.
 */
export function parseAge(years: string, months: string): AgeResult {
  const y = years.trim()
  const m = months.trim()
  if (y === '' && m === '') return { ok: true, ageMonths: null }

  const errors: AgeErrors = {}
  if (y !== '' && !WHOLE_NUMBER.test(y)) errors.years = copy.errors.yearsWhole
  if (m !== '' && !WHOLE_NUMBER.test(m)) errors.months = copy.errors.monthsWhole
  const yearCount = y === '' ? 0 : Number(y)
  const monthCount = m === '' ? 0 : Number(m)
  if (errors.years === undefined && yearCount > LIMITS.ageYearsMax) {
    errors.years = copy.errors.yearsTooOld
  }
  if (errors.months === undefined && !fitsMonths(monthCount))
    errors.months = copy.errors.monthsWhole
  if (errors.years !== undefined || errors.months !== undefined) return { ok: false, errors }

  try {
    return { ok: true, ageMonths: toAgeMonths(yearCount, monthCount) }
  } catch {
    // Each field is in range but together they pass the oldest age, such as 30 years 1 month.
    return { ok: false, errors: { years: copy.errors.yearsTooOld } }
  }
}

/** Whether `toAgeMonths` accepts this many months on their own (the months box stops short of a year). */
function fitsMonths(months: number): boolean {
  try {
    toAgeMonths(0, months)
    return true
  } catch {
    return false
  }
}

type AgeInputProps = {
  years: string
  months: string
  onChangeYears: (years: string) => void
  onChangeMonths: (months: string) => void
  errors: AgeErrors
}

/** Approximate age as years plus optional months, side by side (one under the other on a narrow screen). */
export function AgeInput({ years, months, onChangeYears, onChangeMonths, errors }: AgeInputProps) {
  return (
    <View role="group" aria-label={copy.fields.age} style={styles.group}>
      <Text style={styles.label}>{copy.fields.age}</Text>
      <Text style={styles.hint}>{copy.fields.ageHint}</Text>
      <View style={styles.row}>
        <View style={styles.cell}>
          <Field
            testID="pet-years-input"
            label={copy.fields.years}
            value={years}
            onChangeText={onChangeYears}
            error={errors.years}
            keyboardType="number-pad"
            inputMode="numeric"
          />
        </View>
        <View style={styles.cell}>
          <Field
            testID="pet-months-input"
            label={copy.fields.months}
            value={months}
            onChangeText={onChangeMonths}
            error={errors.months}
            keyboardType="number-pad"
            inputMode="numeric"
          />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  group: { gap: space[8] },
  label: { ...textStyle(type.noteTitle), color: colors.deepBlue },
  hint: { ...textStyle(type.small), color: colors.slate },
  // Each box wants 140 pt: where two don't fit, the second goes below instead of being squeezed.
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space[16] },
  cell: { flexGrow: 1, flexBasis: 140 },
})
