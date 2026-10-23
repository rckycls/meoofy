import { Text } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { onlineManager } from '@tanstack/react-query'
import { act, renderRouter, screen } from 'expo-router/testing-library'
import { checkSession, getProfile, type Profile } from '@pawpin/api'
import { AppError } from '@pawpin/core'

import EntryIndex from '../../app/index'
import { fakeClient } from '../testing/fakeClient'
import { testRootLayout } from '../testing/TestRoot'

jest.mock('@pawpin/api', () => ({
  ...jest.requireActual('@pawpin/api'),
  getProfile: jest.fn(),
  checkSession: jest.fn(),
}))
const mockGetProfile = jest.mocked(getProfile)
const mockCheckSession = jest.mocked(checkSession)

const alex: Profile = {
  id: 'u1',
  displayName: 'Alex',
  onboardingPath: null,
  onboardingCompletedAt: null,
}

function stub(label: string) {
  return function Stub() {
    return <Text>{label}</Text>
  }
}

function routes(client: ReturnType<typeof fakeClient>['client']) {
  return {
    _layout: testRootLayout(client),
    index: EntryIndex,
    '(onboarding)/welcome': stub('Welcome screen'),
    '(auth)/sign-in': stub('Sign-in screen'),
    '(auth)/your-name': stub('Your-name screen'),
    '(tabs)/home': stub('Home screen'),
    '(tabs)/find': stub('Find screen'),
  }
}

beforeEach(async () => {
  await AsyncStorage.clear()
  mockGetProfile.mockReset()
  mockCheckSession.mockReset()
})

describe('entry gate', () => {
  it('opens onboarding on a first launch', async () => {
    const router = await renderRouter(routes(fakeClient().client))

    expect(await screen.findByText('Welcome screen')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/welcome')
  })

  it('opens sign-in once onboarding was seen', async () => {
    await AsyncStorage.setItem('pawpin.onboardingSeen', 'true')
    const router = await renderRouter(routes(fakeClient().client))

    expect(await screen.findByText('Sign-in screen')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/sign-in')
  })

  it('opens Find for a signed-in, named user on the finder path', async () => {
    await AsyncStorage.multiSet([
      ['pawpin.onboardingSeen', 'true'],
      ['pawpin.onboardingPath', 'finder'],
    ])
    mockGetProfile.mockResolvedValue(alex)
    const router = await renderRouter(routes(fakeClient({ userId: 'u1' }).client))

    expect(await screen.findByText('Find screen')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/find')
  })

  it('signs out and opens sign-in when Auth confirms the session is gone', async () => {
    await AsyncStorage.setItem('pawpin.onboardingSeen', 'true')
    mockGetProfile.mockRejectedValue(new AppError('UNAUTHENTICATED'))
    mockCheckSession.mockResolvedValue('rejected')
    const fake = fakeClient({ userId: 'u1' })
    const router = await renderRouter(routes(fake.client))

    expect(await screen.findByText('Sign-in screen')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/sign-in')
    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    // The query layer and the gate share one check.
    expect(mockCheckSession).toHaveBeenCalledTimes(1)
  })

  it('keeps the session and opens Home when Auth cannot be reached', async () => {
    await AsyncStorage.setItem('pawpin.onboardingSeen', 'true')
    mockGetProfile.mockRejectedValue(new AppError('UNAUTHENTICATED'))
    mockCheckSession.mockResolvedValue('unknown')
    const fake = fakeClient({ userId: 'u1' })
    const router = await renderRouter(routes(fake.client))

    expect(await screen.findByText('Home screen')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/home')
    expect(fake.auth.signOut).not.toHaveBeenCalled()
  })

  it('asks for the profile again once the session has refreshed', async () => {
    await AsyncStorage.setItem('pawpin.onboardingSeen', 'true')
    mockGetProfile
      .mockRejectedValueOnce(new AppError('UNAUTHENTICATED'))
      .mockResolvedValue({ ...alex, displayName: '' })
    mockCheckSession.mockResolvedValue('valid')
    const fake = fakeClient({ userId: 'u1' })
    const router = await renderRouter(routes(fake.client))

    expect(await screen.findByText('Your-name screen')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/your-name')
    expect(mockGetProfile).toHaveBeenCalledTimes(2)
    expect(fake.auth.signOut).not.toHaveBeenCalled()
  })

  it('opens Home when the profile cannot be loaded for another reason', async () => {
    await AsyncStorage.setItem('pawpin.onboardingSeen', 'true')
    mockGetProfile.mockRejectedValue(new AppError('UNKNOWN'))
    const router = await renderRouter(routes(fakeClient({ userId: 'u1' }).client))

    expect(await screen.findByText('Home screen')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/home')
  })

  it('opens Home when offline with no cached profile', async () => {
    await AsyncStorage.setItem('pawpin.onboardingSeen', 'true')
    onlineManager.setOnline(false)
    try {
      const router = await renderRouter(routes(fakeClient({ userId: 'u1' }).client))

      expect(await screen.findByText('Home screen')).toBeOnTheScreen()
      expect(router.getPathname()).toBe('/home')
      expect(mockGetProfile).not.toHaveBeenCalled()
    } finally {
      await act(async () => onlineManager.setOnline(true))
    }
  })
})
