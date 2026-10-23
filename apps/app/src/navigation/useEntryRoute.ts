import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getProfile } from '@pawpin/api'
import { onboardingPathSchema, parseAppError, type OnboardingPath } from '@pawpin/core'

import { confirmSession } from '../state/sessionCheck'
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

  // An UNAUTHENTICATED profile read waits for Auth's verdict (shared with the
  // query layer): a refused session signs out, a refreshed one is read again.
  const unauthenticated =
    profile.isError && parseAppError(profile.error).code === 'UNAUTHENTICATED'
      ? profile.error
      : null
  const [checked, setChecked] = useState<Error | null>(null)
  useEffect(() => {
    if (unauthenticated === null) return
    let active = true
    void confirmSession(client, unauthenticated).then(() => {
      if (active) setChecked(unauthenticated)
    })
    return () => {
      active = false
    }
  }, [client, unauthenticated])

  if (device === null) return null
  if (!signedIn) return resolveEntryRoute({ ...device, signedIn, displayName: null })
  if (profile.data !== undefined) {
    return resolveEntryRoute({ ...device, signedIn, displayName: profile.data.displayName })
  }
  if (profile.fetchStatus === 'fetching') return null

  const offline = profile.fetchStatus === 'paused'
  const failed = profile.isError && (unauthenticated === null || checked === unauthenticated)
  if (offline || failed) {
    // The name can't be checked (offline with nothing cached, Auth unreachable,
    // or a server fault). Open the app; its screens show their own error and
    // offline states, and the tab layout sends a signed-out user to sign-in.
    return device.pendingOnboardingPath === 'finder' ? '/(tabs)/find' : '/(tabs)/home'
  }
  // Loading, or waiting for Auth's verdict on an UNAUTHENTICATED read.
  return null
}
