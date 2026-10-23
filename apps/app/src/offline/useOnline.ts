import { useSyncExternalStore } from 'react'
import { Platform } from 'react-native'
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo'
import { onlineManager } from '@tanstack/react-query'

/**
 * Offline only when NetInfo is sure there is no connection; a state it doesn't know yet (`null`,
 * at launch) counts as online. Internet reachability is not used: it is a guess from probe
 * requests, and a wrong "offline" would disable actions that work.
 */
function isConnected(state: NetInfoState): boolean {
  return state.isConnected !== false
}

/**
 * Chromium's offline mode (DevTools, and the browser losing its network) changes
 * `navigator.onLine` and fires the window's `online` and `offline` events, but not the
 * `navigator.connection` change event, the only one NetInfo's web module listens to in a browser
 * that has that API (Chrome, Edge). So on the web the window's events are followed as well.
 */
function followBrowser(setOnline: (online: boolean) => void): () => void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return () => undefined
  // Not every web-like environment has a window with events (server rendering has none at all).
  if (typeof window.addEventListener !== 'function') return () => undefined
  const update = () => setOnline(window.navigator.onLine)
  window.addEventListener('online', update)
  window.addEventListener('offline', update)
  return () => {
    window.removeEventListener('online', update)
    window.removeEventListener('offline', update)
  }
}

/**
 * Feeds the device's connection to TanStack Query's `onlineManager`, which pauses reads while
 * offline and resumes them when the connection returns. NetInfo reads it on iOS, and uses
 * `navigator.onLine` and its events on the web (with the window's own events, see
 * `followBrowser`). TanStack listens while anything listens to it, stops when nothing does, and
 * listens again when something does.
 *
 * Returns the way to stop following: NetInfo is let go and the app is taken to be online again,
 * TanStack's own default when nothing reports the connection.
 */
export function followConnection(): () => void {
  onlineManager.setEventListener((setOnline) => {
    const stopNetInfo = NetInfo.addEventListener((state) => setOnline(isConnected(state)))
    const stopBrowser = followBrowser(setOnline)
    return () => {
      stopNetInfo()
      stopBrowser()
    }
  })
  return () => {
    onlineManager.setEventListener(() => undefined)
    onlineManager.setOnline(true)
  }
}

const subscribe = (onChange: () => void) => onlineManager.subscribe(onChange)
const isOnline = () => onlineManager.isOnline()
// Server rendering has no connection to ask about.
const isOnlineOnServer = () => true

/** Whether the device has a connection, as `onlineManager` knows it; re-renders when that changes. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, isOnline, isOnlineOnServer)
}
