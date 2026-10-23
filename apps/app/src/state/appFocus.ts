import { AppState, Platform } from 'react-native'
import { focusManager } from '@tanstack/react-query'

/**
 * Tells TanStack Query when the iOS app comes to the front (AppState), so stale reads refresh
 * then; the web keeps TanStack's own `visibilitychange` listener. TanStack listens to AppState
 * while anything listens to it. Returns the way to stop.
 */
export function followAppFocus(): () => void {
  if (Platform.OS === 'web') return () => undefined
  focusManager.setEventListener((setFocused) => {
    const subscription = AppState.addEventListener('change', (state) =>
      setFocused(state === 'active'),
    )
    return () => subscription.remove()
  })
  return () => {
    focusManager.setEventListener(() => undefined)
    focusManager.setFocused(undefined)
  }
}
