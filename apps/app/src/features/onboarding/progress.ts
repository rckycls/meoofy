import { router, type Href } from 'expo-router'
import type { OnboardingPath } from '@meoofy/core'

import { local } from '../../storage/local'

/**
 * Keeps the O01 choice on the device until the first sign-in records it. A
 * storage failure only means the choice is not remembered; it never blocks the
 * flow.
 */
export async function rememberPath(path: OnboardingPath): Promise<void> {
  try {
    await local.set('meoofy.onboardingPath', path)
  } catch {
    // The choice is lost, and the person is treated as an owner.
  }
}

/** O02 is done: later launches skip onboarding and open sign-in. */
export async function markOnboardingSeen(): Promise<void> {
  try {
    await local.set('meoofy.onboardingSeen', 'true')
  } catch {
    // Onboarding shows again on the next launch, which is harmless.
  }
}

/**
 * One step back. A screen that was opened directly (a web reload, a deep link)
 * has nothing to go back to, so it goes to `fallback`.
 */
export function stepBack(fallback: Href): void {
  if (router.canGoBack()) router.back()
  else router.replace(fallback)
}
