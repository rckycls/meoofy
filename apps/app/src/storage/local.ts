import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

/** Device-local keys (AsyncStorage on iOS, localStorage on the web). */
export type LocalKey =
  /** `'true'` once onboarding O00–O02 is done on this device. */
  | 'meoofy.onboardingSeen'
  /** The O01 choice (`OnboardingPath`) until it is recorded after sign-in. */
  | 'meoofy.onboardingPath'
  /** The unsent add-pet form, as JSON. */
  | 'meoofy.petDraft'

/** AsyncStorage's calls, which the web's localStorage answers synchronously. */
export type DeviceStorage = {
  getItem(key: string): string | null | Promise<string | null>
  setItem(key: string, value: string): void | Promise<void>
  removeItem(key: string): void | Promise<void>
}

/**
 * Where device-local data lives: AsyncStorage on iOS, localStorage on the web. `undefined` where
 * there is nowhere to keep it: the web build rendering on the server (no `window`), or a browser
 * that blocks site data (reading `localStorage` throws).
 */
export function storageFor(os: typeof Platform.OS): DeviceStorage | undefined {
  if (os !== 'web') return AsyncStorage
  if (typeof window === 'undefined') return undefined
  try {
    return window.localStorage ?? undefined
  } catch {
    return undefined
  }
}

export const local = {
  async get(key: LocalKey): Promise<string | null> {
    return (await storageFor(Platform.OS)?.getItem(key)) ?? null
  },
  async set(key: LocalKey, value: string): Promise<void> {
    await storageFor(Platform.OS)?.setItem(key, value)
  },
  async remove(key: LocalKey): Promise<void> {
    await storageFor(Platform.OS)?.removeItem(key)
  },
}
