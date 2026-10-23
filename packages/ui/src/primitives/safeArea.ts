import { useContext } from 'react'
import { SafeAreaInsetsContext, type EdgeInsets } from 'react-native-safe-area-context'

const NO_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 }

/**
 * Safe-area insets from the nearest `SafeAreaProvider`, or zeros without one.
 * (`useSafeAreaInsets` throws with no provider, which would make every
 * primitive that pads for the notch unusable in isolation.)
 */
export function useInsets(): EdgeInsets {
  return useContext(SafeAreaInsetsContext) ?? NO_INSETS
}
