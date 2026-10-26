import {
  AppError,
  displayNameSchema,
  onboardingPathSchema,
  type OnboardingPath,
} from '@meoofy/core'
import type { MeoofyClient } from './client'
import { toAppError, withStatus } from './errors'
import { toProfile, type Profile } from './types'

/**
 * The signed-in user's profile. A session with no profile behind it (the user was deleted)
 * rejects with UNAUTHENTICATED, like an expired one.
 */
export async function getProfile(c: MeoofyClient): Promise<Profile> {
  try {
    const { data, error, status } = await c
      .from('my_profile')
      .select('id, display_name, onboarding_path, onboarding_completed_at')
      .maybeSingle()
    if (error) throw withStatus(error, status)
    if (data === null) throw new AppError('UNAUTHENTICATED', 'no profile for this session')
    return toProfile(data)
  } catch (e) {
    throw toAppError(e)
  }
}

/**
 * Records the onboarding path chosen before sign-in. Idempotent: only the first call counts.
 */
export async function completeOnboarding(c: MeoofyClient, path: OnboardingPath): Promise<void> {
  try {
    const parsed = onboardingPathSchema.safeParse(path)
    if (!parsed.success) throw new AppError('VALIDATION', 'unknown onboarding path')
    const { error, status } = await c.rpc('complete_onboarding', { path: parsed.data })
    if (error) throw withStatus(error, status)
  } catch (e) {
    throw toAppError(e)
  }
}

/**
 * Sets the display name, trimmed. An empty or over-long name rejects with VALIDATION before any
 * request is made.
 */
export async function updateDisplayName(c: MeoofyClient, name: string): Promise<void> {
  try {
    const parsed = displayNameSchema.safeParse(name)
    if (!parsed.success) {
      throw new AppError('VALIDATION', parsed.error.issues[0]?.message ?? 'invalid display name')
    }
    const { error, status } = await c.rpc('update_profile', { display_name: parsed.data })
    if (error) throw withStatus(error, status)
  } catch (e) {
    throw toAppError(e)
  }
}
