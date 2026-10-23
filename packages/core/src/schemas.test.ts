import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  codePointLength,
  displayNameSchema,
  onboardingPathSchema,
  petInputSchema,
  petPatchSchema,
  photoRequestSchema,
  photoViewSchema,
  speciesSchema,
  type OnboardingPath,
  type PetInput,
  type PetPatch,
  type PhotoRequest,
  type PhotoView,
  type Species,
} from './schemas'

const base = {
  id: '7b6f3a52-6a0c-4a43-9a1e-2f0b6f0a9d11',
  name: 'Milo',
  species: 'dog',
  breed: null,
  ageMonths: 36,
}

describe('codePointLength', () => {
  it('counts Unicode code points, not UTF-16 units', () => {
    expect(codePointLength('')).toBe(0)
    expect(codePointLength('Milo')).toBe(4)
    expect(codePointLength('🐶🐶')).toBe(2)
  })
})

describe('enums', () => {
  it('accepts only the spec values', () => {
    expect(speciesSchema.safeParse('dog').success).toBe(true)
    expect(speciesSchema.safeParse('cat').success).toBe(true)
    expect(speciesSchema.safeParse('rabbit').success).toBe(false)
    for (const v of ['front', 'side', 'markings', 'extra']) {
      expect(photoViewSchema.safeParse(v).success).toBe(true)
    }
    expect(photoViewSchema.safeParse('back').success).toBe(false)
    expect(onboardingPathSchema.safeParse('owner').success).toBe(true)
    expect(onboardingPathSchema.safeParse('finder').success).toBe(true)
    expect(onboardingPathSchema.safeParse('vet').success).toBe(false)
  })
})

describe('petInputSchema', () => {
  it('accepts a valid pet', () => {
    expect(petInputSchema.parse(base)).toEqual(base)
  })

  it('trims the name', () => {
    expect(petInputSchema.parse({ ...base, name: '  Milo  ' }).name).toBe('Milo')
  })

  it('rejects a blank name', () => {
    expect(petInputSchema.safeParse({ ...base, name: '   ' }).success).toBe(false)
    expect(petInputSchema.safeParse({ ...base, name: '' }).success).toBe(false)
  })

  it('counts code points', () => {
    expect(petInputSchema.safeParse({ ...base, name: '🐶'.repeat(40) }).success).toBe(true)
    expect(petInputSchema.safeParse({ ...base, name: '🐶'.repeat(41) }).success).toBe(false)
  })

  it('normalises an empty breed to null and trims it', () => {
    expect(petInputSchema.parse({ ...base, breed: '' }).breed).toBeNull()
    expect(petInputSchema.parse({ ...base, breed: '   ' }).breed).toBeNull()
    expect(petInputSchema.parse({ ...base, breed: '  Beagle ' }).breed).toBe('Beagle')
  })

  it('limits the breed to 80 code points', () => {
    expect(petInputSchema.safeParse({ ...base, breed: 'x'.repeat(80) }).success).toBe(true)
    expect(petInputSchema.safeParse({ ...base, breed: 'x'.repeat(81) }).success).toBe(false)
    expect(petInputSchema.safeParse({ ...base, breed: '🐶'.repeat(80) }).success).toBe(true)
    expect(petInputSchema.safeParse({ ...base, breed: '🐶'.repeat(81) }).success).toBe(false)
  })

  it('bounds the age to 0-360 whole months, or null', () => {
    expect(petInputSchema.safeParse({ ...base, ageMonths: 0 }).success).toBe(true)
    expect(petInputSchema.safeParse({ ...base, ageMonths: 360 }).success).toBe(true)
    expect(petInputSchema.safeParse({ ...base, ageMonths: null }).success).toBe(true)
    expect(petInputSchema.safeParse({ ...base, ageMonths: 361 }).success).toBe(false)
    expect(petInputSchema.safeParse({ ...base, ageMonths: -1 }).success).toBe(false)
    expect(petInputSchema.safeParse({ ...base, ageMonths: 1.5 }).success).toBe(false)
  })

  it('rejects an unknown species', () => {
    expect(petInputSchema.safeParse({ ...base, species: 'rabbit' }).success).toBe(false)
  })

  it('rejects a non-uuid id but accepts any Postgres-valid uuid', () => {
    expect(petInputSchema.safeParse({ ...base, id: 'nope' }).success).toBe(false)
    expect(
      petInputSchema.safeParse({ ...base, id: '00000000-0000-0000-0000-000000000001' }).success,
    ).toBe(true)
  })

  it('infers the output types', () => {
    expectTypeOf<PetInput>().toEqualTypeOf<{
      id: string
      name: string
      species: Species
      breed: string | null
      ageMonths: number | null
    }>()
    expectTypeOf<PetPatch>().toEqualTypeOf<{
      name?: string
      species?: Species
      breed?: string | null
      ageMonths?: number | null
    }>()
    expectTypeOf<Species>().toEqualTypeOf<'dog' | 'cat'>()
    expectTypeOf<PhotoView>().toEqualTypeOf<'front' | 'side' | 'markings' | 'extra'>()
    expectTypeOf<OnboardingPath>().toEqualTypeOf<'owner' | 'finder'>()
    expectTypeOf<PhotoRequest['contentType']>().toEqualTypeOf<'image/jpeg'>()
  })
})

describe('petPatchSchema', () => {
  it('makes every field optional and drops the id', () => {
    expect(petPatchSchema.parse({})).toEqual({})
    expect(petPatchSchema.parse({ name: '  Luna ' })).toEqual({ name: 'Luna' })
    expect(petPatchSchema.parse({ id: base.id, name: 'Luna' })).toEqual({ name: 'Luna' })
  })

  it('still validates the fields it is given', () => {
    expect(petPatchSchema.safeParse({ name: '   ' }).success).toBe(false)
    expect(petPatchSchema.safeParse({ ageMonths: 361 }).success).toBe(false)
    expect(petPatchSchema.safeParse({ breed: 'x'.repeat(81) }).success).toBe(false)
  })

  it('keeps an explicit null breed distinct from an absent one', () => {
    expect(petPatchSchema.parse({ breed: '' })).toEqual({ breed: null })
    expect('breed' in petPatchSchema.parse({})).toBe(false)
  })
})

describe('displayNameSchema', () => {
  it('trims and enforces 1-40 code points', () => {
    expect(displayNameSchema.parse('  Alex  ')).toBe('Alex')
    expect(displayNameSchema.safeParse('A'.repeat(40)).success).toBe(true)
    expect(displayNameSchema.safeParse('A'.repeat(41)).success).toBe(false)
    expect(displayNameSchema.safeParse('   ').success).toBe(false)
    expect(displayNameSchema.safeParse('🐶'.repeat(40)).success).toBe(true)
    expect(displayNameSchema.safeParse('🐶'.repeat(41)).success).toBe(false)
  })
})

describe('photoRequestSchema', () => {
  const ok = {
    id: base.id,
    petId: base.id,
    view: 'side',
    contentType: 'image/jpeg',
    bytes: 4194304,
  }

  it('accepts a JPEG request at the size limit', () => {
    expect(photoRequestSchema.safeParse(ok).success).toBe(true)
  })

  it('rejects non-JPEG content types', () => {
    expect(
      photoRequestSchema.safeParse({
        id: base.id,
        petId: base.id,
        view: 'front',
        contentType: 'image/png',
        bytes: 10,
      }).success,
    ).toBe(false)
  })

  it('rejects files over 4 MiB', () => {
    expect(photoRequestSchema.safeParse({ ...ok, bytes: 4194305 }).success).toBe(false)
  })

  it('rejects empty, negative and fractional sizes', () => {
    expect(photoRequestSchema.safeParse({ ...ok, bytes: 0 }).success).toBe(false)
    expect(photoRequestSchema.safeParse({ ...ok, bytes: -5 }).success).toBe(false)
    expect(photoRequestSchema.safeParse({ ...ok, bytes: 10.5 }).success).toBe(false)
  })

  it('rejects an unknown view', () => {
    expect(photoRequestSchema.safeParse({ ...ok, view: 'back' }).success).toBe(false)
  })

  it('rejects ids that are not uuids', () => {
    expect(photoRequestSchema.safeParse({ ...ok, id: 'x' }).success).toBe(false)
    expect(photoRequestSchema.safeParse({ ...ok, petId: 'x' }).success).toBe(false)
  })
})
