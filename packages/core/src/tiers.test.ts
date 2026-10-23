import { describe, expect, it } from 'vitest'
import { canAddPet, petLimit } from './tiers'

describe('petLimit', () => {
  it('returns the pet limit for each tier', () => {
    expect(petLimit('free')).toBe(3)
    expect(petLimit('pro')).toBe(10)
    expect(petLimit('max')).toBeNull()
  })
})

describe('canAddPet', () => {
  it('allows adding until the tier limit is reached', () => {
    expect(canAddPet('free', 2)).toBe(true)
    expect(canAddPet('free', 3)).toBe(false)
    expect(canAddPet('pro', 9)).toBe(true)
    expect(canAddPet('pro', 10)).toBe(false)
  })

  it('never blocks the max tier', () => {
    expect(canAddPet('max', 999)).toBe(true)
  })
})
