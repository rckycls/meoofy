export type Tier = 'free' | 'pro' | 'max'

const PET_LIMITS: Record<Tier, number | null> = {
  free: 3,
  pro: 10,
  max: null,
}

/** Most active pets a tier may own, or `null` when the tier is unlimited. */
export function petLimit(tier: Tier): number | null {
  return PET_LIMITS[tier]
}

/** Whether an owner on `tier` with `activePets` pets may add one more. */
export function canAddPet(tier: Tier, activePets: number): boolean {
  const limit = petLimit(tier)
  return limit === null || activePets < limit
}
