import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'
import { useReducedMotion } from 'react-native-reanimated'

/**
 * Whether the person asked the system to reduce motion.
 *
 * Reanimated's `useReducedMotion` reads the setting once at launch and never
 * re-renders, so a change made while the app is open would be missed. The
 * listener below picks that up. Either source being on counts as reduced, so
 * the worst case is staying calm until the next launch.
 */
export function useMotionPreference(): { reduced: boolean } {
  const atLaunch = useReducedMotion()
  const [live, setLive] = useState(false)

  useEffect(() => {
    let mounted = true
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setLive(value)
    })
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setLive)
    return () => {
      mounted = false
      subscription.remove()
    }
  }, [])

  return { reduced: atLaunch || live }
}
