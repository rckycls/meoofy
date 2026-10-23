import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getProfile } from '@pawpin/api'
import { onboardingPathSchema, parseAppError, type OnboardingPath } from '@pawpin/core'

import { useSession } from '../state/SessionProvider'
import { local } from '../storage/local'
import { resolveEntryRoute, type EntryRoute } from './entry'

type DeviceState = { onboardingSeen: boolean; pendingOnboardingPath: OnboardingPath | null }

async function readDeviceState(): Promise<DeviceState> {
  try {
    const [seen, path] = await Promise.all([
      local.get('pawpin.onboardingSeen'),
      local.get('pawpin.onboardingPath'),
    ])
    const parsed = onboardingPathSchema.safeParse(path)
    return {
      onboardingSeen: seen === 'true',
      pendingOnboardingPath: parsed.success ? parsed.data : null,
    }
  } catch {
    // Unreadable storage behaves like a fresh install.
    return { onboardingSeen: false, pendingOnboardingPath: null }
  }
}

/** The cold-start route, or `null` while it is still being worked out. */
export function useEntryRoute(): EntryRoute | null {
  const { client, signedIn } = useSession()
  const [device, setDevice] = useState<DeviceState | null>(null)

  useEffect(() => {
    let active = true
    void readDeviceState().then((state) => {
      if (active) setDevice(state)
    })
    return () => {
      active = false
    }
  }, [])

  const profile = useQuery({
    queryKey: ['profile'],
    queryFn: () => getProfile(client),
    enabled: signedIn,
  })

  if (device === null) return null
  if (!signedIn) return resolveEntryRoute({ ...device, signedIn, displayName: null })
  if (profile.data !== undefined) {
    return resolveEntryRoute({ ...device, signedIn, displayName: profile.data.displayName })
  }
  const offline = profile.fetchStatus === 'paused'
  if (offline || (profile.isError && parseAppError(profile.error).code !== 'UNAUTHENTICATED')) {
    // The name can't be checked (offline with nothing cached, or a server
    // fault). Open the app; its screens show their own error and offline states.
    return device.pendingOnboardingPath === 'finder' ? '/(tabs)/find' : '/(tabs)/home'
  }
  // Loading, or UNAUTHENTICATED: QueryProvider signs out and this re-runs signed out.
  return null
}
