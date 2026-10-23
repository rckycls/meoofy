import { useCallback, useEffect, useState } from 'react'

/**
 * Whole seconds left of `seconds`, counting down from now. Computed from the clock rather than by
 * counting ticks, so a throttled timer (a backgrounded tab) still ends on time.
 */
export function useCountdown(seconds: number): { remaining: number; restart: () => void } {
  const [endsAt, setEndsAt] = useState(() => Date.now() + seconds * 1000)
  const [remaining, setRemaining] = useState(seconds)

  useEffect(() => {
    const update = () => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
      setRemaining(left)
      return left
    }
    if (update() === 0) return
    const timer = setInterval(() => {
      if (update() === 0) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [endsAt])

  const restart = useCallback(() => {
    setRemaining(seconds)
    setEndsAt(Date.now() + seconds * 1000)
  }, [seconds])

  return { remaining, restart }
}
