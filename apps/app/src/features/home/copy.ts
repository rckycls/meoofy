import type { Entitlement } from '@pawpin/api'
import type { Tier } from '@pawpin/core'

import { plansCopy } from '../plans/copy'

const petCount = (count: number) => `${count} ${count === 1 ? 'pet' : 'pets'}`

/** English copy for Home (O02) and the empty registry (S01). */
export const homeCopy = {
  /** A blank or unknown name leaves the greeting without one. */
  greeting: (name: string | null | undefined) => {
    const trimmed = name?.trim() ?? ''
    return trimmed === '' ? 'Hello' : `Hello, ${trimmed}`
  },
  loading: 'Loading your pets',
  empty: {
    title: 'Your circle starts here',
    body: 'Add your first pet. It takes about two minutes and stays private.',
    action: 'Add my first pet',
  },
  addPet: 'Add a pet',
  species: { dog: 'Dog', cat: 'Cat' },
  plan: {
    comparePlans: 'Compare plans',
    /** The phone's one-line summary: "2 of 3 · Free". */
    line: ({ tier, petLimit, activePets }: Entitlement) =>
      petLimit === null
        ? `${petCount(activePets)} · ${plansCopy.tierNames[tier]}, unlimited`
        : `${activePets} of ${petLimit} · ${plansCopy.tierNames[tier]}`,
    /** The desktop plan card's title: "Free · 2 of 3 pets". */
    cardTitle: ({ tier, petLimit, activePets }: Entitlement) =>
      petLimit === null
        ? `${plansCopy.tierNames[tier]} · ${petCount(activePets)}, unlimited`
        : `${plansCopy.tierNames[tier]} · ${activePets} of ${petLimit} pets`,
    unknownCardTitle: 'Your plan',
    /** Shown when "Add a pet" leads to Compare plans, because the plan is full. */
    full: (tier: Tier, limit: number) =>
      `You’ve added ${petCount(limit)}, the most the ${plansCopy.tierNames[tier]} plan allows. Compare plans to add more.`,
  },
  errors: {
    offline: 'You seem to be offline. Check your connection and try again.',
    loadFailed: 'We couldn’t load your pets. Please try again.',
    retry: 'Try again',
  },
} as const
