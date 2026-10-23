import { useEffect, useState } from 'react'
import { completeOnboarding, type PawpinClient } from '@pawpin/api'
import { onboardingPathSchema, type OnboardingPath } from '@pawpin/core'

import { useSession } from '../../state/SessionProvider'
import { local } from '../../storage/local'

async function readStoredPath(): Promise<OnboardingPath | null> {
  try {
    const parsed = onboardingPathSchema.safeParse(await local.get('pawpin.onboardingPath'))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

async function sendPath(client: PawpinClient, path: OnboardingPath): Promise<void> {
  try {
    await completeOnboarding(client, path)
    await local.remove('pawpin.onboardingPath')
  } catch {
    // Offline, or the session ended. The key stays, so the next screen shown
    // after sign-in tries again; the server keeps the first path it is given.
  }
}

type Run = {
  /** The stored path, as soon as it has been read. */
  path: Promise<OnboardingPath | null>
  /** Settles (never rejects) once the path has been sent and the key removed. */
  done: Promise<void>
}

// Screens that use the hook can be up together (O03, then the tabs). They share
// one run, so the path is sent once.
let current: Run | null = null

function start(client: PawpinClient): Run {
  const path = readStoredPath()
  const done = path.then((stored) => (stored === null ? undefined : sendPath(client, stored)))
  void done.finally(() => {
    current = null
  })
  return { path, done }
}

/**
 * After the first sign-in, tells the server which path the person chose in O01
 * and removes the device's copy. Does nothing when signed out or when no path
 * is stored. Returns the path that was found (even while it is still being
 * sent, and even if sending fails), so a screen can still use it once the key
 * is gone.
 *
 * Used by O03 and by the tab layout, which covers a sign-in that never shows
 * O03 (a returning user, or a name that came from Apple).
 */
export function useRecordOnboardingPath(): OnboardingPath | null {
  const { client, signedIn } = useSession()
  const [found, setFound] = useState<OnboardingPath | null>(null)

  useEffect(() => {
    if (!signedIn) return
    let active = true
    const run = (current ??= start(client))
    void run.path.then((path) => {
      if (active && path !== null) setFound(path)
    })
    return () => {
      active = false
    }
  }, [client, signedIn])

  return found
}
