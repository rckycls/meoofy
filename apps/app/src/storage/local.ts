import AsyncStorage from '@react-native-async-storage/async-storage'

/** Device-local keys (AsyncStorage on iOS, localStorage on the web). */
export type LocalKey =
  /** `'true'` once onboarding O00–O02 is done on this device. */
  | 'pawpin.onboardingSeen'
  /** The O01 choice (`OnboardingPath`) until it is recorded after sign-in. */
  | 'pawpin.onboardingPath'
  /** The unsent add-pet form, as JSON. */
  | 'pawpin.petDraft'

export const local = {
  get(key: LocalKey): Promise<string | null> {
    return AsyncStorage.getItem(key)
  },
  set(key: LocalKey, value: string): Promise<void> {
    return AsyncStorage.setItem(key, value)
  },
  remove(key: LocalKey): Promise<void> {
    return AsyncStorage.removeItem(key)
  },
}
