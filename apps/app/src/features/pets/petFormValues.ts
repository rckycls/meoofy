import type { Pet } from '@meoofy/api'
import {
  codePointLength,
  petInputSchema,
  type PetInput,
  type PetPatch,
  type Species,
} from '@meoofy/core'

import { parseAge, type AgeErrors } from './AgeInput'
import { petsCopy as copy } from './copy'

/** The form as typed: every field is its raw text. */
export type Values = {
  name: string
  species: Species
  breed: string
  years: string
  months: string
}
export type FieldErrors = AgeErrors & { name?: string; breed?: string }
/** What a valid form holds: a trimmed name, a breed or `null`, and the age in months or `null`. */
export type Basics = Omit<PetInput, 'id'>

export const EMPTY: Values = { name: '', species: 'dog', breed: '', years: '', months: '' }

// The id belongs to the create call (it is made once per form), not to the form's fields.
const basicsSchema = petInputSchema.omit({ id: true })

/** The errors a field's edit makes out of date: a change to one age box clears both age errors. */
export const clearedBy: Record<keyof Values, readonly (keyof FieldErrors)[]> = {
  name: ['name'],
  species: [],
  breed: ['breed'],
  years: ['years', 'months'],
  months: ['years', 'months'],
}

export function readBasics(
  values: Values,
): { ok: true; basics: Basics } | { ok: false; errors: FieldErrors } {
  const age = parseAge(values.years, values.months)
  const errors: FieldErrors = age.ok ? {} : { ...age.errors }
  const parsed = basicsSchema.safeParse({
    name: values.name,
    species: values.species,
    breed: values.breed,
    ageMonths: age.ok ? age.ageMonths : null,
  })
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      if (issue.path[0] === 'name') {
        errors.name =
          codePointLength(values.name.trim()) === 0
            ? copy.errors.nameRequired
            : copy.errors.nameTooLong
      } else if (issue.path[0] === 'breed') {
        errors.breed = copy.errors.breedTooLong
      }
    }
  }
  return parsed.success && age.ok ? { ok: true, basics: parsed.data } : { ok: false, errors }
}

/** The form's fields for a saved pet: the age is split back into years and months. */
export function valuesOf(pet: Pet): Values {
  const { ageMonths } = pet
  return {
    name: pet.name,
    species: pet.species,
    breed: pet.breed ?? '',
    years: ageMonths === null ? '' : String(Math.floor(ageMonths / 12)),
    months: ageMonths === null || ageMonths % 12 === 0 ? '' : String(ageMonths % 12),
  }
}

/** Only the fields that differ from the saved pet; an emptied breed or age is `null`. */
export function changesTo(pet: Pet, basics: Basics): PetPatch {
  const patch: PetPatch = {}
  if (basics.name !== pet.name) patch.name = basics.name
  if (basics.species !== pet.species) patch.species = basics.species
  if (basics.breed !== pet.breed) patch.breed = basics.breed
  if (basics.ageMonths !== pet.ageMonths) patch.ageMonths = basics.ageMonths
  return patch
}
