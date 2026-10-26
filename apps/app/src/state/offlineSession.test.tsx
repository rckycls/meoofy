// Review Focus #5 and Ruling 31: the app opens without a network after a previous session.
//
// Offline, supabase-js retries the refresh of an expired access token for about 25 s and then
// sends INITIAL_SESSION with no session, while keeping the session stored (it deletes a stored
// session only when Auth refuses it). The app opens at once on that person's saved data, and Auth
// stays the only judge of the session: nothing here is sent with the stored session.
import { Text } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library'
import {
  getEntitlement,
  getProfile,
  listPets,
  readStoredSession,
  type Entitlement,
  type Pet,
  type Profile,
} from '@meoofy/api'
import { AppError } from '@meoofy/core'

import AccountTab from '../../app/(tabs)/account'
import EntryIndex from '../../app/index'
import TabsLayout from '../../app/(tabs)/_layout'
import HomeTab from '../../app/(tabs)/home'
import { loadDraft, saveDraft } from '../offline/draft'
import { fakeClient } from '../testing/fakeClient'
import { changeConnection, startWithConnection } from '../testing/netInfo'
import { seedPersistedCache } from '../testing/persistedCache'
import { testRootStackLayout } from '../testing/TestRoot'

jest.mock('@meoofy/api', () => ({
  ...jest.requireActual('@meoofy/api'),
  readStoredSession: jest.fn(),
  listPets: jest.fn(),
  getEntitlement: jest.fn(),
  getProfile: jest.fn(),
  checkSession: jest.fn(async () => 'unknown'),
}))
const mockReadStoredSession = jest.mocked(readStoredSession)
const mockListPets = jest.mocked(listPets)
const mockGetEntitlement = jest.mocked(getEntitlement)
const mockGetProfile = jest.mocked(getProfile)

const BANNER = 'You’re offline. Saved information is available.'

const milo: Pet = {
  id: '2f0c9a64-1b5e-4c6d-8a3f-5d7e9b1c2a40',
  name: 'Milo',
  species: 'dog',
  breed: 'Beagle',
  ageMonths: 38,
  registrationState: 'private',
  discoveryEnabled: false,
  createdAt: '2026-10-01T00:00:00Z',
}
const alex: Profile = {
  id: 'u1',
  displayName: 'Alex',
  onboardingPath: 'owner',
  onboardingCompletedAt: '2026-10-01T00:00:00Z',
}
const free1: Entitlement = { tier: 'free', petLimit: 3, activePets: 1 }

let queryClient: QueryClient | null = null
function HomeWithCache() {
  queryClient = useQueryClient()
  return <HomeTab />
}

function stub(label: string) {
  return function Stub() {
    return <Text>{label}</Text>
  }
}

/** Opens the app from its entry route, as a cold start does, with Auth still deciding. */
async function coldStart({ signOutFails = false }: { signOutFails?: boolean } = {}) {
  queryClient = null
  const fake = fakeClient({ userId: null, initialSession: 'held', signOutFails })
  const router = await renderRouter(
    {
      _layout: testRootStackLayout(fake.client),
      index: EntryIndex,
      '(tabs)/_layout': TabsLayout,
      '(tabs)/home': HomeWithCache,
      '(tabs)/find': stub('Find screen'),
      '(tabs)/alerts': stub('Alerts screen'),
      '(tabs)/account': AccountTab,
      '(onboarding)/welcome': stub('Welcome screen'),
      '(auth)/sign-in': stub('Sign-in screen'),
      '(auth)/your-name': stub('Your-name screen'),
    },
    { initialUrl: '/' },
  )
  return { router, fake }
}

const banner = () => screen.queryByRole('status', { name: BANNER })
/** Lets work the screens started without waiting for it (such as forgetting the draft) finish. */
const settle = () => act(async () => undefined)
const cachedPets = () => queryClient?.getQueryData<Pet[]>(['pets'])

beforeEach(async () => {
  await AsyncStorage.clear()
  await AsyncStorage.setItem('meoofy.onboardingSeen', 'true')
  // What the last session saved, and the session it left stored.
  await seedPersistedCache([
    [['pets'], [milo]],
    [['entitlement'], free1],
    [['profile'], alex],
  ])
  mockReadStoredSession.mockReset().mockResolvedValue({ userId: 'u1', email: 'alex@example.com' })
  // Whatever the server is asked waits: what shows can only have come from the device.
  mockListPets.mockReset().mockReturnValue(new Promise(() => undefined))
  mockGetEntitlement.mockReset().mockReturnValue(new Promise(() => undefined))
  mockGetProfile.mockReset().mockReturnValue(new Promise(() => undefined))
  startWithConnection(false)
})

describe('an offline cold start with a stored session', () => {
  it('opens on Home with the saved pets and the banner while supabase-js still retries', async () => {
    const { router } = await coldStart()

    expect(await screen.findByText('Milo')).toBeOnTheScreen()
    expect(screen.getByRole('header', { name: 'Hello, Alex' })).toBeOnTheScreen()
    expect(banner()).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/home')
    expect(screen.queryByText('Sign-in screen')).toBeNull()
    expect(mockListPets).not.toHaveBeenCalled()
  })

  it('stays signed in when the refresh fails offline (no session, but still stored)', async () => {
    const { router, fake } = await coldStart()
    await screen.findByText('Milo')

    await act(async () => fake.releaseInitialSession())

    expect(mockReadStoredSession).toHaveBeenCalledTimes(2)
    expect(router.getPathname()).toBe('/home')
    expect(screen.getByText('Milo')).toBeOnTheScreen()
    expect(banner()).toBeOnTheScreen()
  })

  it('keeps the cache and the draft when the session refreshes for the same person', async () => {
    const { fake } = await coldStart()
    await screen.findByText('Milo')
    await act(async () => fake.releaseInitialSession())
    await saveDraft({ name: 'Luna' })
    // Back online before Auth has refreshed: supabase-js has no session to send, so the server
    // refuses the read. Nothing is lost, and nobody is signed out for it.
    mockListPets.mockReset().mockRejectedValueOnce(new AppError('UNAUTHENTICATED'))
    mockListPets.mockResolvedValue([milo])

    await changeConnection(true)
    await waitFor(() => expect(mockListPets).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Milo')).toBeOnTheScreen()

    await act(async () => fake.refresh('u1', 'alex@example.com'))

    // Confirmed by Auth: what is on screen is asked for again, and the cache was never dropped.
    await waitFor(() => expect(mockListPets).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Milo')).toBeOnTheScreen()
    expect(cachedPets()).toEqual([milo])
    expect(await loadDraft()).toEqual({ name: 'Luna' })
    expect(banner()).toBeNull()
    expect(screen.queryByText('Sign-in screen')).toBeNull()
  })

  it('wipes the cache and the draft when a different person signs in', async () => {
    const { fake } = await coldStart()
    await screen.findByText('Milo')
    await saveDraft({ name: 'Luna' })

    await changeConnection(true)
    await act(async () => fake.signIn('u2', 'sam@example.com'))

    await waitFor(() => expect(cachedPets()).toBeUndefined())
    await settle()
    expect(await loadDraft()).toBeNull()
  })

  it('signs out and wipes the cache when Auth refuses the session once the connection is back', async () => {
    const { router, fake } = await coldStart()
    await screen.findByText('Milo')
    await saveDraft({ name: 'Luna' })

    await changeConnection(true)
    // supabase-js deletes the session Auth refused, then reports SIGNED_OUT.
    mockReadStoredSession.mockResolvedValue(null)
    await act(async () => fake.refuse())

    expect(await screen.findByText('Sign-in screen')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/sign-in')
    expect(cachedPets()).toBeUndefined()
    await settle()
    expect(await loadDraft()).toBeNull()
  })

  it('signs out when supabase-js reports no session and none is stored any more', async () => {
    const { router, fake } = await coldStart()
    await screen.findByText('Milo')

    // Auth refused the refresh while the app was opening: the session was deleted.
    mockReadStoredSession.mockResolvedValue(null)
    await act(async () => fake.releaseInitialSession())

    expect(await screen.findByText('Sign-in screen')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/sign-in')
  })
})

describe('signing out from the saved session', () => {
  async function signOutFromAccount() {
    await fireEvent.press(screen.getByRole('tab', { name: 'Account' }))
    await fireEvent.press(await screen.findByRole('button', { name: 'Sign out' }))
  }

  it('offline, ends on sign-in with the cache and the draft gone', async () => {
    // Offline supabase-js can't load the expired session, so its own sign-out would err and keep it.
    const { router } = await coldStart({ signOutFails: true })
    await screen.findByText('Milo')
    await saveDraft({ name: 'Luna' })

    await signOutFromAccount()

    expect(await screen.findByText('Sign-in screen')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/sign-in')
    expect(cachedPets()).toBeUndefined()
    await settle()
    expect(await loadDraft()).toBeNull()
  })

  it('back online, still ends on sign-in when supabase-js cannot sign the session out', async () => {
    // supabase-js can't load the expired session it couldn't refresh, so it keeps it and errs.
    const { router, fake } = await coldStart({ signOutFails: true })
    await screen.findByText('Milo')
    await act(async () => fake.releaseInitialSession())
    await saveDraft({ name: 'Luna' })
    await changeConnection(true)

    await signOutFromAccount()

    expect(await screen.findByText('Sign-in screen')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/sign-in')
    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(cachedPets()).toBeUndefined()
    await settle()
    expect(await loadDraft()).toBeNull()
  })
})

describe('the saved cache', () => {
  it('is not opened for someone else: a cache saved by another person is dropped', async () => {
    // The app was killed before the save after a sign-in caught up.
    await seedPersistedCache([[['pets'], [milo]]], { owner: 'u2' })

    await coldStart()

    expect(
      await screen.findByText('You seem to be offline. Check your connection and try again.'),
    ).toBeOnTheScreen()
    expect(screen.queryByText('Milo')).toBeNull()
    expect(cachedPets()).toBeUndefined()
    // Gone from the device too: whatever is saved now is this person's (nothing yet).
    await settle()
    expect((await AsyncStorage.getItem('meoofy.queryCache')) ?? '').not.toContain('Milo')
  })
})

describe('a cold start that is not offline', () => {
  it('waits for Auth instead of opening from the stored session', async () => {
    startWithConnection(true)
    const { router, fake } = await coldStart()
    // The stored session has been read and the connection reported. (Only microtasks: the test
    // router spins while the root renders nothing, so no timer would ever fire here.)
    await settle()

    expect(mockReadStoredSession).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Milo')).toBeNull()
    expect(screen.queryByText('Sign-in screen')).toBeNull()

    await act(async () => fake.refresh('u1', 'alex@example.com'))
    await act(async () => fake.releaseInitialSession())

    expect(await screen.findByText('Milo')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/home')
    expect(banner()).toBeNull()
  })

  it('stays signed in when Auth cannot be reached to refresh the stored session', async () => {
    startWithConnection(true)
    const { router, fake } = await coldStart()

    // A server that is down: supabase-js reports no session and keeps it stored.
    await act(async () => fake.releaseInitialSession())

    expect(await screen.findByText('Milo')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/home')
    expect(screen.queryByText('Sign-in screen')).toBeNull()
  })

  it('opens sign-in when no session is stored', async () => {
    startWithConnection(true)
    mockReadStoredSession.mockResolvedValue(null)
    const { router, fake } = await coldStart()

    await act(async () => fake.releaseInitialSession())

    expect(await screen.findByText('Sign-in screen')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/sign-in')
  })
})
