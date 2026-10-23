import { resolveEntryRoute } from './entry'

describe('resolveEntryRoute', () => {
  it('sends a first launch to onboarding', () => {
    expect(
      resolveEntryRoute({
        onboardingSeen: false,
        signedIn: false,
        displayName: null,
        pendingOnboardingPath: null,
      }),
    ).toBe('/(onboarding)/welcome')
  })

  it('signed-out state routes to sign-in', () =>
    expect(
      resolveEntryRoute({
        onboardingSeen: true,
        signedIn: false,
        displayName: null,
        pendingOnboardingPath: 'owner',
      }),
    ).toBe('/(auth)/sign-in'))

  it('asks a signed-in user without a name for one', () => {
    expect(
      resolveEntryRoute({
        onboardingSeen: true,
        signedIn: true,
        displayName: '',
        pendingOnboardingPath: null,
      }),
    ).toBe('/(auth)/your-name')
    expect(
      resolveEntryRoute({
        onboardingSeen: true,
        signedIn: true,
        displayName: null,
        pendingOnboardingPath: null,
      }),
    ).toBe('/(auth)/your-name')
  })

  it('opens Home for a signed-in, named user', () => {
    expect(
      resolveEntryRoute({
        onboardingSeen: true,
        signedIn: true,
        displayName: 'Alex',
        pendingOnboardingPath: null,
      }),
    ).toBe('/(tabs)/home')
  })

  it('opens Find for a named user who chose the finder path', () => {
    expect(
      resolveEntryRoute({
        onboardingSeen: true,
        signedIn: true,
        displayName: 'Alex',
        pendingOnboardingPath: 'finder',
      }),
    ).toBe('/(tabs)/find')
  })

  it('keeps a signed-in user out of onboarding when this device has not seen it', () => {
    // iOS keeps the Keychain (the session) across a reinstall but not AsyncStorage.
    expect(
      resolveEntryRoute({
        onboardingSeen: false,
        signedIn: true,
        displayName: 'Alex',
        pendingOnboardingPath: null,
      }),
    ).toBe('/(tabs)/home')
  })
})
