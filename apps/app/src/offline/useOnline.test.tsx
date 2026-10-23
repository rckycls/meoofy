import { AppState, Platform, Text, type AppStateStatus } from 'react-native'
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo'
import { focusManager, onlineManager } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react-native'

import { followAppFocus } from '../state/appFocus'
import { followConnection, useOnline } from './useOnline'

type NetListener = (state: NetInfoState) => void
const mockAddEventListener = jest.mocked(NetInfo.addEventListener)

const net = (isConnected: boolean | null) => ({ isConnected }) as NetInfoState

let report: NetListener = () => undefined
const unsubscribeNetInfo = jest.fn()

beforeEach(() => {
  unsubscribeNetInfo.mockClear()
  mockAddEventListener.mockReset().mockImplementation((listener: NetListener) => {
    report = listener
    return unsubscribeNetInfo
  })
})

afterEach(() => {
  onlineManager.setOnline(true)
})

describe('followConnection', () => {
  it('tells TanStack Query what NetInfo knows about the connection', () => {
    const stop = followConnection()
    const listening = onlineManager.subscribe(() => undefined)

    report(net(false))
    expect(onlineManager.isOnline()).toBe(false)
    report(net(true))
    expect(onlineManager.isOnline()).toBe(true)

    listening()
    stop()
  })

  it('counts a connection NetInfo is not sure about yet as online', () => {
    const stop = followConnection()
    const listening = onlineManager.subscribe(() => undefined)

    report(net(false))
    report(net(null))

    expect(onlineManager.isOnline()).toBe(true)
    listening()
    stop()
  })

  it('listens to NetInfo only while something listens to it, and again when something does', () => {
    const stop = followConnection()
    const first = onlineManager.subscribe(() => undefined)
    expect(mockAddEventListener).toHaveBeenCalledTimes(1)

    first()
    expect(unsubscribeNetInfo).toHaveBeenCalledTimes(1)

    const second = onlineManager.subscribe(() => undefined)
    expect(mockAddEventListener).toHaveBeenCalledTimes(2)
    report(net(false))
    expect(onlineManager.isOnline()).toBe(false)

    second()
    stop()
    expect(unsubscribeNetInfo).toHaveBeenCalledTimes(2)
  })

  it('stops listening when stopped, and leaves the app taken as online', () => {
    const stop = followConnection()
    const listening = onlineManager.subscribe(() => undefined)
    report(net(false))

    stop()

    expect(unsubscribeNetInfo).toHaveBeenCalledTimes(1)
    expect(onlineManager.isOnline()).toBe(true)
    listening()
    // Nothing subscribes to NetInfo again.
    onlineManager.subscribe(() => undefined)()
    expect(mockAddEventListener).toHaveBeenCalledTimes(1)
  })
})

describe('followConnection in a browser', () => {
  // Chromium's offline mode (DevTools, Playwright's setOffline) changes `navigator.onLine` and
  // fires the window's `offline` and `online` events, but not the `navigator.connection` change
  // event, the only one NetInfo's web module listens to in a browser that has that API.
  const target = new EventTarget()
  const addListener = jest.fn(target.addEventListener.bind(target))
  let onLine = true
  let os: ReturnType<typeof jest.replaceProperty>
  const own = ['addEventListener', 'removeEventListener', 'navigator'] as const
  const saved = own.map((name) => Object.getOwnPropertyDescriptor(window, name))

  beforeEach(() => {
    addListener.mockClear()
    os = jest.replaceProperty(Platform, 'OS', 'web')
    Object.defineProperties(window, {
      addEventListener: { configurable: true, value: addListener },
      removeEventListener: { configurable: true, value: target.removeEventListener.bind(target) },
      navigator: {
        configurable: true,
        value: {
          get onLine() {
            return onLine
          },
        },
      },
    })
  })

  afterEach(() => {
    os.restore()
    own.forEach((name, index) => {
      const descriptor = saved[index]
      if (descriptor === undefined) delete (window as unknown as Record<string, unknown>)[name]
      else Object.defineProperty(window, name, descriptor)
    })
    onLine = true
  })

  const browser = (online: boolean) => {
    onLine = online
    target.dispatchEvent(new Event(online ? 'online' : 'offline'))
  }

  it('follows the browser going offline and coming back', () => {
    const stop = followConnection()
    const listening = onlineManager.subscribe(() => undefined)

    browser(false)
    expect(onlineManager.isOnline()).toBe(false)
    browser(true)
    expect(onlineManager.isOnline()).toBe(true)

    listening()
    stop()
  })

  it('stops following the browser with nothing listening', () => {
    const stop = followConnection()
    onlineManager.subscribe(() => undefined)()

    browser(false)

    expect(onlineManager.isOnline()).toBe(true)
    stop()
  })

  it('leaves iOS to NetInfo alone', () => {
    os.restore()
    const stop = followConnection()
    const listening = onlineManager.subscribe(() => undefined)

    expect(addListener).not.toHaveBeenCalled()
    listening()
    stop()
  })
})

function Status() {
  return <Text>{useOnline() ? 'online' : 'offline'}</Text>
}

describe('useOnline', () => {
  it('follows the connection', async () => {
    const stop = followConnection()
    await render(<Status />)
    expect(screen.getByText('online')).toBeOnTheScreen()

    await act(async () => report(net(false)))
    expect(screen.getByText('offline')).toBeOnTheScreen()

    await act(async () => report(net(true)))
    expect(screen.getByText('online')).toBeOnTheScreen()
    stop()
  })
})

describe('followAppFocus', () => {
  const mockAppStateListen = jest.mocked(AppState.addEventListener)

  afterEach(() => {
    focusManager.setFocused(undefined)
  })

  function appStateHandler(): (state: AppStateStatus) => void {
    const call = [...mockAppStateListen.mock.calls].reverse().find(([event]) => event === 'change')
    if (call === undefined) throw new Error('no AppState listener')
    return call[1] as (state: AppStateStatus) => void
  }

  it('tells TanStack Query when the app goes to the background and comes back on iOS', () => {
    const remove = jest.fn()
    mockAppStateListen.mockReturnValue({ remove } as unknown as ReturnType<
      typeof AppState.addEventListener
    >)
    const stop = followAppFocus()
    const listening = focusManager.subscribe(() => undefined)

    appStateHandler()('background')
    expect(focusManager.isFocused()).toBe(false)
    appStateHandler()('active')
    expect(focusManager.isFocused()).toBe(true)

    listening()
    stop()
    expect(remove).toHaveBeenCalled()
  })

  it('leaves the web to its own visibility events', () => {
    const os = jest.replaceProperty(Platform, 'OS', 'web')
    try {
      mockAppStateListen.mockClear()
      const stop = followAppFocus()
      const listening = focusManager.subscribe(() => undefined)

      expect(mockAppStateListen).not.toHaveBeenCalled()
      listening()
      stop()
    } finally {
      os.restore()
    }
  })
})
