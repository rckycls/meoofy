import { Text } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { act, render, screen, waitFor } from '@testing-library/react-native'
import { onlineManager, useIsRestoring, useQuery, useQueryClient } from '@tanstack/react-query'
import * as SecureStore from 'expo-secure-store'
import { checkSession } from '@pawpin/api'
import { AppError } from '@pawpin/core'

import { fakeClient } from '../testing/fakeClient'
import { TestProviders } from '../testing/TestRoot'
import { retryQuery, shouldPersistQuery } from './QueryProvider'
import { sessionStorageFor, useSession } from './SessionProvider'

jest.mock('@pawpin/api', () => ({
  ...jest.requireActual('@pawpin/api'),
  checkSession: jest.fn(),
}))
const mockCheckSession = jest.mocked(checkSession)

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => 'stored'),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}))

describe('query policy', () => {
  it('retries network and rate-limit failures up to 3 times', () => {
    const network = new AppError('NETWORK')
    expect(retryQuery(0, network)).toBe(true)
    expect(retryQuery(2, network)).toBe(true)
    expect(retryQuery(3, network)).toBe(false)
    expect(retryQuery(0, new AppError('RATE_LIMITED'))).toBe(true)
    expect(retryQuery(0, new TypeError('Network request failed'))).toBe(true)
  })

  it('never retries typed errors that a retry cannot fix', () => {
    expect(retryQuery(0, new AppError('VALIDATION'))).toBe(false)
    expect(retryQuery(0, new AppError('UNAUTHENTICATED'))).toBe(false)
    expect(retryQuery(0, new Error('boom'))).toBe(false)
  })

  it('persists only the pets, entitlement and profile queries', () => {
    expect(shouldPersistQuery(['pets'])).toBe(true)
    expect(shouldPersistQuery(['entitlement'])).toBe(true)
    expect(shouldPersistQuery(['profile'])).toBe(true)
    expect(shouldPersistQuery(['pets', 'p1'])).toBe(false)
    expect(shouldPersistQuery(['photos', 'p1'])).toBe(false)
  })
})

describe('session storage', () => {
  it("leaves the web on Supabase's default storage", () => {
    expect(sessionStorageFor('web')).toBeUndefined()
  })

  it('keeps the iOS session in the secure store', async () => {
    const storage = sessionStorageFor('ios')
    if (storage === undefined) throw new Error('expected a storage adapter on iOS')

    await expect(storage.getItem('sb-auth')).resolves.toBe('stored')
    await storage.setItem('sb-auth', '{"a":1}')
    await storage.removeItem('sb-auth')

    expect(SecureStore.getItemAsync).toHaveBeenCalledWith('sb-auth')
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('sb-auth', '{"a":1}')
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('sb-auth')
  })
})

function SessionProbe() {
  const { signedIn, userId } = useSession()
  return <Text>{signedIn ? `signed in as ${userId}` : 'signed out'}</Text>
}

describe('SessionProvider', () => {
  it('follows auth events', async () => {
    const fake = fakeClient({ userId: null })
    await render(
      <TestProviders client={fake.client}>
        <SessionProbe />
      </TestProviders>,
    )

    expect(await screen.findByText('signed out')).toBeOnTheScreen()
    await act(async () => fake.signIn('u2'))
    expect(screen.getByText('signed in as u2')).toBeOnTheScreen()
    await act(async () => {
      await fake.client.auth.signOut({ scope: 'local' })
    })
    expect(screen.getByText('signed out')).toBeOnTheScreen()
  })

  it('throws a clear error outside the provider', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(render(<SessionProbe />)).rejects.toThrow(/SessionProvider/)
    consoleError.mockRestore()
  })
})

function ProfileQuery({ queryFn }: { queryFn: () => Promise<string> }) {
  const query = useQuery({ queryKey: ['profile'], queryFn, retry: false })
  return <Text>{query.status === 'success' ? `hello ${query.data}` : query.status}</Text>
}

let cacheProbe: ReturnType<typeof useQueryClient> | null = null
let restoringProbe = true
function CacheProbe() {
  cacheProbe = useQueryClient()
  restoringProbe = useIsRestoring()
  return null
}

beforeEach(() => {
  cacheProbe = null
  restoringProbe = true
  mockCheckSession.mockReset()
})

describe('QueryProvider', () => {
  const unauthenticated = () => Promise.reject(new AppError('UNAUTHENTICATED'))

  it('signs out locally when Auth confirms a read was refused because the session is gone', async () => {
    mockCheckSession.mockResolvedValue('rejected')
    const fake = fakeClient({ userId: 'u1' })
    await render(
      <TestProviders client={fake.client}>
        <ProfileQuery queryFn={unauthenticated} />
      </TestProviders>,
    )

    await waitFor(() => expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' }))
    expect(mockCheckSession).toHaveBeenCalledWith(fake.client)
  })

  it('keeps the session when Auth cannot be reached to confirm', async () => {
    mockCheckSession.mockResolvedValue('unknown')
    const fake = fakeClient({ userId: 'u1' })
    await render(
      <TestProviders client={fake.client}>
        <ProfileQuery queryFn={unauthenticated} />
      </TestProviders>,
    )

    await waitFor(() => expect(mockCheckSession).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('error')).toBeOnTheScreen()
    expect(fake.auth.signOut).not.toHaveBeenCalled()
  })

  it('asks once more after the session refreshed', async () => {
    mockCheckSession.mockResolvedValue('valid')
    const queryFn = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new AppError('UNAUTHENTICATED'))
      .mockResolvedValue('Alex')
    const fake = fakeClient({ userId: 'u1' })
    await render(
      <TestProviders client={fake.client}>
        <ProfileQuery queryFn={queryFn} />
      </TestProviders>,
    )

    expect(await screen.findByText('hello Alex')).toBeOnTheScreen()
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(fake.auth.signOut).not.toHaveBeenCalled()
  })

  it('asks only once more when the read keeps failing after a refresh', async () => {
    mockCheckSession.mockResolvedValue('valid')
    const queryFn = jest.fn(unauthenticated)
    const fake = fakeClient({ userId: 'u1' })
    await render(
      <TestProviders client={fake.client}>
        <ProfileQuery queryFn={queryFn} />
      </TestProviders>,
    )

    await waitFor(() => expect(mockCheckSession).toHaveBeenCalledTimes(2))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(fake.auth.signOut).not.toHaveBeenCalled()
  })

  it('keeps the session on other read failures without asking Auth', async () => {
    const fake = fakeClient({ userId: 'u1' })
    await render(
      <TestProviders client={fake.client}>
        <ProfileQuery queryFn={() => Promise.reject(new AppError('UNKNOWN'))} />
      </TestProviders>,
    )

    expect(await screen.findByText('error')).toBeOnTheScreen()
    expect(mockCheckSession).not.toHaveBeenCalled()
    expect(fake.auth.signOut).not.toHaveBeenCalled()
  })

  it("drops the previous user's cached data when the user changes", async () => {
    const fake = fakeClient({ userId: 'u1' })
    await render(
      <TestProviders client={fake.client}>
        <CacheProbe />
      </TestProviders>,
    )
    await waitFor(() => expect(cacheProbe).not.toBeNull())
    await act(async () => {
      cacheProbe?.setQueryData(['pets'], [{ id: 'p1' }])
    })
    expect(cacheProbe?.getQueryData(['pets'])).toEqual([{ id: 'p1' }])

    await act(async () => {
      await fake.client.auth.signOut({ scope: 'local' })
    })

    expect(cacheProbe?.getQueryData(['pets'])).toBeUndefined()
  })

  it('writes only the pets, entitlement and profile queries to disk, and no mutations', async () => {
    type Saved = { clientState: { queries: { queryKey: unknown[] }[]; mutations: unknown[] } }
    // Earlier tests' throttled saves can still land, so read this test's own writes.
    const setItem = jest.mocked(AsyncStorage.setItem)
    setItem.mockClear()
    const cacheWrites = () =>
      setItem.mock.calls.filter(([key]) => key === 'pawpin.queryCache').map(([, value]) => value)

    const fake = fakeClient({ userId: 'u1' })
    await render(
      <TestProviders client={fake.client}>
        <CacheProbe />
      </TestProviders>,
    )
    await waitFor(() => expect(restoringProbe).toBe(false))
    const queryClient = cacheProbe
    if (queryClient === null) throw new Error('expected the query client')

    onlineManager.setOnline(false)
    try {
      await act(async () => {
        // Offline, a mutation pauses with its variables (the pet's details) in memory.
        const mutation = queryClient.getMutationCache().build(queryClient, {
          mutationKey: ['createPet'],
          mutationFn: async () => 'created',
        })
        void mutation.execute({ name: 'Milo' }).catch(() => undefined)
        queryClient.setQueryData(['pets'], [{ id: 'pet-dehydrate-test' }])
        queryClient.setQueryData(['profile'], { displayName: 'Alex' })
        queryClient.setQueryData(['pets', 'p1'], { id: 'p1' })
        queryClient.setQueryData(['photos', 'p1'], [])
      })
      expect(queryClient.getMutationCache().getAll()[0]?.state.isPaused).toBe(true)

      // Saves are throttled; wait for the one that holds both queries set above.
      const saved = await waitFor(
        () => {
          const write = cacheWrites().find(
            (value) => value.includes('pet-dehydrate-test') && value.includes('Alex'),
          )
          if (write === undefined) throw new Error('not saved yet')
          return JSON.parse(write) as Saved
        },
        { timeout: 3000 },
      )
      expect(saved.clientState.queries.map((query) => query.queryKey)).toEqual([
        ['pets'],
        ['profile'],
      ])
      expect(saved.clientState.mutations).toEqual([])
      expect(cacheWrites().some((value) => value.includes('Milo'))).toBe(false)
    } finally {
      onlineManager.setOnline(true)
    }
  })
})
