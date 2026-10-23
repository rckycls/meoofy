import { useCallback, useEffect, useRef, useState } from 'react'
import { router, type Href } from 'expo-router'

import { useSession } from '../../state/SessionProvider'

type Resolve = () => Promise<Href>

/**
 * Returns a function to call when a sign-in has just succeeded. It waits until the session layer
 * has reported the new session, runs `resolve` (which picks the destination and may do a last
 * step first, and must not reject), then opens the destination.
 *
 * Waiting matters twice: the entry gate reads the session, and would otherwise see a signed-out
 * person for a moment and send them back to sign-in; and the query cache is cleared when the
 * signed-in user changes, which must happen before `resolve` puts anything in it.
 */
export function useContinueWhenSignedIn(): (resolve: Resolve) => void {
  const { signedIn } = useSession()
  const [pending, setPending] = useState<Resolve | null>(null)
  // The destination is worked out once, even if the effect runs twice.
  const started = useRef<Promise<Href> | null>(null)

  useEffect(() => {
    if (pending === null || !signedIn) return
    let active = true
    started.current ??= pending()
    void started.current.then((href) => {
      if (active) router.replace(href)
    })
    return () => {
      active = false
    }
  }, [pending, signedIn])

  return useCallback((resolve: Resolve) => {
    started.current = null
    setPending(() => resolve)
  }, [])
}
