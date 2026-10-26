import { useCallback, useEffect, useRef, useState } from 'react'
import type { PhotoView } from '@meoofy/core'

/**
 * How long a view's "Try again" stays off after the server says RATE_LIMITED (spec §9: "with a
 * retry after a delay"). The server's limit is a rolling hour, so trying again at once would be
 * refused again. This is a UX value and not a domain limit, so it is not in core's `LIMITS` (which
 * feeds the generated SQL). The words in `photosCopy.retryWait` promise no time, so they hold
 * whatever this is set to.
 */
export const RATE_LIMITED_RETRY_DELAY_MS = 60_000

/**
 * A wait per view: `start(view)` begins (or begins again) the wait of `RATE_LIMITED_RETRY_DELAY_MS`,
 * and `isWaiting(view)` is true until it ends. Other views are not affected. Pending timers are
 * cleared when the screen goes away.
 */
export function useRetryCooldown() {
  const [waiting, setWaiting] = useState<Partial<Record<PhotoView, true>>>({})
  const timers = useRef(new Map<PhotoView, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach((timer) => clearTimeout(timer))
      pending.clear()
    }
  }, [])

  const start = useCallback((view: PhotoView) => {
    clearTimeout(timers.current.get(view))
    setWaiting((all) => ({ ...all, [view]: true }))
    timers.current.set(
      view,
      setTimeout(() => {
        timers.current.delete(view)
        setWaiting((all) => {
          const rest = { ...all }
          delete rest[view]
          return rest
        })
      }, RATE_LIMITED_RETRY_DELAY_MS),
    )
  }, [])

  const isWaiting = useCallback((view: PhotoView) => waiting[view] === true, [waiting])

  return { start, isWaiting }
}
