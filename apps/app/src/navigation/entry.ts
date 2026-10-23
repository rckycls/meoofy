import type { OnboardingPath } from '@pawpin/core'

export type EntryRoute =
  | '/(onboarding)/welcome'
  | '/(auth)/sign-in'
  | '/(auth)/your-name'
  | '/(tabs)/home'
  | '/(tabs)/find'

export type EntryState = {
  /** This device finished onboarding (O00–O02). */
  onboardingSeen: boolean
  signedIn: boolean
  /** The profile's display name; empty or `null` until the name step is done. */
  displayName: string | null
  /** The path chosen in O01 that has not been recorded on the server yet. */
  pendingOnboardingPath: OnboardingPath | null
}

/** Where a cold start lands. */
export function resolveEntryRoute(s: EntryState): EntryRoute {
  // A session wins over the onboarding flag: iOS keeps the session (Keychain)
  // across a reinstall, while AsyncStorage starts empty.
  if (s.signedIn) {
    if (s.displayName === null || s.displayName.trim() === '') return '/(auth)/your-name'
    return s.pendingOnboardingPath === 'finder' ? '/(tabs)/find' : '/(tabs)/home'
  }
  return s.onboardingSeen ? '/(auth)/sign-in' : '/(onboarding)/welcome'
}
