import { AppError, type OnboardingPath, type Tier } from '@pawpin/core'
import type { Database } from './database.types'

type Views = Database['api']['Views']

export type Profile = {
  id: string
  displayName: string
  onboardingPath: OnboardingPath | null
  onboardingCompletedAt: string | null
}

export type Entitlement = {
  tier: Tier
  /** Most private pets the tier allows, or `null` when unlimited (max). */
  petLimit: number | null
  activePets: number
}

// Postgres reports every view column as nullable, so the generated row types do too. The columns
// below come from NOT NULL table columns; a null there means the view changed underneath us.

export function toProfile(row: Views['my_profile']['Row']): Profile {
  if (row.id === null) throw new AppError('UNKNOWN', 'api.my_profile returned a row without id')
  return {
    id: row.id,
    displayName: row.display_name ?? '',
    onboardingPath: row.onboarding_path,
    onboardingCompletedAt: row.onboarding_completed_at,
  }
}

export function toEntitlement(row: Views['my_entitlement']['Row']): Entitlement {
  if (row.tier === null) {
    throw new AppError('UNKNOWN', 'api.my_entitlement returned a row without tier')
  }
  return { tier: row.tier, petLimit: row.pet_limit, activePets: row.active_pets ?? 0 }
}
