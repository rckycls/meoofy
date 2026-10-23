import { useSyncExternalStore } from 'react'
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
 * Feeds the device's connection to TanStack Query's `onlineManager`, which pauses reads while
 * offline and resumes them when the connection returns. NetInfo reads it on iOS, and uses
 * `navigator.onLine` and its events on the web. TanStack listens to NetInfo while anything
 * listens to it, stops when nothing does, and listens again when something does.
 *
 * Returns the way to stop following: NetInfo is let go and the app is taken to be online again,
 * TanStack's own default when nothing reports the connection.
 */
export function followConnection(): () => void {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => setOnline(isConnected(state))),
  )
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
