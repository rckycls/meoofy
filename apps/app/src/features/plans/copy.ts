import type { Tier } from '@meoofy/core'

/** The plans in order, cheapest first. */
export const TIERS: readonly Tier[] = ['free', 'pro', 'max']

/** English copy for Compare plans, and the plan names other screens use. */
export const plansCopy = {
  title: 'Compare plans',
  body: 'Paid plans aren’t available yet. Every pet you add stays private.',
  back: 'Back',
  tierNames: { free: 'Free', pro: 'Pro', max: 'Max' } satisfies Record<Tier, string>,
  /** What a plan covers; `limit` is `null` for a plan with no limit. */
  pets: (limit: number | null) => (limit === null ? 'Unlimited pets' : `Up to ${limit} pets`),
  current: 'Your plan',
  comingSoon: 'Coming soon',
} as const
