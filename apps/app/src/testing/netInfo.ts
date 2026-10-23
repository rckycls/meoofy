import NetInfo, { type NetInfoState } from '@react-native-community/netinfo'
import { act } from '@testing-library/react-native'

// Drives the official NetInfo jest mock (installed in jest.setup.js): subscribers hear the
// connection at once, as NetInfo calls a new listener with the latest state, and again on change.

type Listener = (state: NetInfoState) => void

const listeners = new Set<Listener>()
let connected = true

function current(): NetInfoState {
  return (
    connected
      ? { type: 'wifi', isConnected: true, isInternetReachable: true, details: {} }
      : { type: 'none', isConnected: false, isInternetReachable: false, details: null }
  ) as NetInfoState
}

/** The device has (or lacks) a connection when the app starts. */
export function startWithConnection(isConnected: boolean): void {
  connected = isConnected
  listeners.clear()
  jest.mocked(NetInfo.addEventListener).mockImplementation((listener: Listener) => {
    listeners.add(listener)
    listener(current())
    return () => {
      listeners.delete(listener)
    }
  })
}

/** The connection comes or goes while the app runs. */
export async function changeConnection(isConnected: boolean): Promise<void> {
  connected = isConnected
  await act(async () => {
    listeners.forEach((listener) => listener(current()))
  })
}
