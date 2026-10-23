import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { local, storageFor } from './local'

type Global = { window?: unknown }
const g = globalThis as Global

/** Runs `run` with `window` replaced (or removed, for `undefined`), then puts it back. */
async function withWindow(window: unknown, run: () => unknown) {
  const saved = Object.getOwnPropertyDescriptor(g, 'window')
  Object.defineProperty(g, 'window', { value: window, configurable: true, writable: true })
  try {
    await run()
  } finally {
    if (saved === undefined) delete g.window
    else Object.defineProperty(g, 'window', saved)
  }
}

beforeEach(async () => {
  await AsyncStorage.clear()
})

describe('device storage', () => {
  it('is AsyncStorage on iOS', async () => {
    expect(storageFor('ios')).toBe(AsyncStorage)

    await local.set('pawpin.onboardingSeen', 'true')

    expect(await AsyncStorage.getItem('pawpin.onboardingSeen')).toBe('true')
    expect(await local.get('pawpin.onboardingSeen')).toBe('true')
    await local.remove('pawpin.onboardingSeen')
    expect(await local.get('pawpin.onboardingSeen')).toBeNull()
  })

  it('is localStorage on the web', async () => {
    const localStorage = { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }
    await withWindow({ localStorage }, () => {
      expect(storageFor('web')).toBe(localStorage)
    })
  })

  it('is missing while the web build renders without a window, or when the browser blocks it', async () => {
    await withWindow(undefined, () => {
      expect(storageFor('web')).toBeUndefined()
    })
    const blocked = {
      get localStorage() {
        throw new Error('SecurityError')
      },
    }
    await withWindow(blocked, () => {
      expect(storageFor('web')).toBeUndefined()
    })
  })

  it('reads and keeps nothing on the web without a window, and never throws', async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'web')
    try {
      await withWindow(undefined, async () => {
        await expect(local.set('pawpin.petDraft', '{}')).resolves.toBeUndefined()
        await expect(local.get('pawpin.petDraft')).resolves.toBeNull()
        await expect(local.remove('pawpin.petDraft')).resolves.toBeUndefined()
      })
    } finally {
      os.restore()
    }
  })
})
