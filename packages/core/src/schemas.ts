import { z } from 'zod'
import { LIMITS } from './limits'

/** Length in Unicode code points, so "🐶🐶" is 2 (matches Postgres `char_length`). */
export function codePointLength(s: string): number {
  return [...s].length
}

/** Trims, then requires `min..max` code points. Returns the trimmed string. */
function boundedText(min: number, max: number, label: string) {
  return z
    .string()
    .transform((s) => s.trim())
    .refine((s) => codePointLength(s) >= min && codePointLength(s) <= max, {
      message:
        min === 0
          ? `${label} must be at most ${max} characters`
          : `${label} must be ${min}-${max} characters`,
    })
}

/** Accepts any 8-4-4-4-12 hex id, like Postgres `uuid` (zod's `uuid()` also requires RFC version/variant bits). */
const idSchema = z.guid()

export const speciesSchema = z.enum(['dog', 'cat'])
export type Species = z.infer<typeof speciesSchema>

export const photoViewSchema = z.enum(['front', 'side', 'markings', 'extra'])
export type PhotoView = z.infer<typeof photoViewSchema>

export const onboardingPathSchema = z.enum(['owner', 'finder'])
export type OnboardingPath = z.infer<typeof onboardingPathSchema>

const petNameSchema = boundedText(1, LIMITS.petNameMax, 'Name')

/** Optional breed/description: trimmed, at most 80 code points, `''` becomes `null`. */
const breedSchema = boundedText(0, LIMITS.breedMax, 'Breed')
  .transform((s) => (s === '' ? null : s))
  .nullable()

/** Approximate age in whole months, or `null` when unknown. */
const ageMonthsSchema = z.number().int().min(0).max(LIMITS.ageMonthsMax).nullable()

export const petInputSchema = z.object({
  id: idSchema,
  name: petNameSchema,
  species: speciesSchema,
  breed: breedSchema,
  ageMonths: ageMonthsSchema,
})
export type PetInput = z.infer<typeof petInputSchema>

/**
 * Partial update: every field optional, no `id`. An absent field is left unchanged;
 * an explicit `null` breed or age clears it.
 */
export const petPatchSchema = petInputSchema.omit({ id: true }).partial()
export type PetPatch = z.infer<typeof petPatchSchema>

export const displayNameSchema = boundedText(1, LIMITS.displayNameMax, 'Display name')

export const photoRequestSchema = z.object({
  id: idSchema,
  petId: idSchema,
  view: photoViewSchema,
  contentType: z.literal('image/jpeg'),
  bytes: z.number().int().min(1).max(LIMITS.photoMaxBytes),
})
export type PhotoRequest = z.infer<typeof photoRequestSchema>
