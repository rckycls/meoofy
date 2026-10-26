import { useEffect } from 'react'
import { Text } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Sentry from '@sentry/react-native'
import { act, render, screen, waitFor } from '@testing-library/react-native'
import {
  onlineManager,
  useIsRestoring,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import * as SecureStore from 'expo-secure-store'
import { checkSession } from '@meoofy/api'
import { AppError } from '@meoofy/core'

import { fakeClient } from '../testing/fakeClient'
import { TestProviders } from '../testing/TestRoot'
import { retryQuery, shouldPersistQuery } from './QueryProvider'
import { sessionStorageFor, useSession } from './SessionProvider'

jest.mock('@meoofy/api', () => ({
  ...jest.requireActual('@meoofy/api'),
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
  const { signedIn, userId, email } = useSession()
  return (
    <>
      <Text>{signedIn ? `signed in as ${userId}` : 'signed out'}</Text>
      <Text>{`email: ${email ?? 'none'}`}</Text>
    </>
  )
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

  it('carries the signed-in email, and none when the session has none or ends', async () => {
    const fake = fakeClient({ userId: null })
    await render(
      <TestProviders client={fake.client}>
        <SessionProbe />
      </TestProviders>,
    )

    expect(await screen.findByText('email: none')).toBeOnTheScreen()
    await act(async () => fake.signIn('u2', 'alex@example.com'))
    expect(screen.getByText('email: alex@example.com')).toBeOnTheScreen()
    await act(async () => {
      await fake.client.auth.signOut({ scope: 'local' })
    })
    expect(screen.getByText('email: none')).toBeOnTheScreen()
    // A session without an email (Apple can hide it) reads as none, not as "undefined".
    await act(async () => fake.signIn('u3'))
    expect(screen.getByText('email: none')).toBeOnTheScreen()
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

/** Runs one mutation with `mutationKey` as soon as it mounts, and shows how it ended. */
function Mutation({ mutationFn }: { mutationFn: () => Promise<string> }) {
  const { mutate, status } = useMutation({ mutationKey: ['createPet'], mutationFn })
  useEffect(() => mutate(), [mutate])
  return <Text>{`mutation ${status}`}</Text>
}

describe('QueryProvider: unexpected failures go to Sentry, sanitised (spec §9)', () => {
  /** A failure whose message and details name a pet and a person. */
  const unexpected = () =>
    Promise.reject(
      new AppError('UNKNOWN', 'Failing row contains (Milo, alex@example.com)', {
        cause: {
          code: '23514',
          message: 'Failing row contains (Milo, alex@example.com)',
          details: 'Failing row contains (Milo, alex@example.com)',
          status: 400,
        },
      }),
    )
  const sent = () => jest.mocked(Sentry.captureException).mock.calls.map(([error]) => error)

  beforeEach(() => {
    jest.mocked(Sentry.captureException).mockClear()
    jest.mocked(Sentry.getClient).mockReturnValue({} as ReturnType<typeof Sentry.getClient>)
  })
  afterEach(() => {
    jest.mocked(Sentry.getClient).mockReset()
  })

  it('sends an unexpected read failure, named after the query and stripped of its message', async () => {
    await render(
      <TestProviders client={fakeClient({ userId: 'u1' }).client}>
        <ProfileQuery queryFn={unexpected} />
      </TestProviders>,
    )

    expect(await screen.findByText('error')).toBeOnTheScreen()
    await waitFor(() => expect(Sentry.captureException).toHaveBeenCalledTimes(1))
    expect(sent()[0]).toMatchObject({ message: 'UNKNOWN in profile (HTTP 400, Postgres 23514)' })
    expect(JSON.stringify(jest.mocked(Sentry.captureException).mock.calls)).not.toMatch(
      /Milo|alex@example\.com/,
    )
  })

  it('sends an unexpected write failure, named after the mutation', async () => {
    await render(
      <TestProviders client={fakeClient({ userId: 'u1' }).client}>
        <Mutation mutationFn={unexpected} />
      </TestProviders>,
    )

    expect(await screen.findByText('mutation error')).toBeOnTheScreen()
    expect(sent()).toEqual([
      expect.objectContaining({ message: 'UNKNOWN in createPet (HTTP 400, Postgres 23514)' }),
    ])
  })

  it('sends nothing for the failures the app expects', async () => {
    mockCheckSession.mockResolvedValue('unknown')
    await render(
      <TestProviders client={fakeClient({ userId: 'u1' }).client}>
        <ProfileQuery queryFn={() => Promise.reject(new AppError('UNAUTHENTICATED'))} />
        <Mutation mutationFn={() => Promise.reject(new AppError('VALIDATION'))} />
      </TestProviders>,
    )

    expect(await screen.findByText('error')).toBeOnTheScreen()
    expect(await screen.findByText('mutation error')).toBeOnTheScreen()
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it('sends nothing while Sentry is off', async () => {
    jest.mocked(Sentry.getClient).mockReturnValue(undefined)
    await render(
      <TestProviders client={fakeClient({ userId: 'u1' }).client}>
        <ProfileQuery queryFn={unexpected} />
      </TestProviders>,
    )

    expect(await screen.findByText('error')).toBeOnTheScreen()
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })
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

  it('signs out when Auth refused the session even if supabase-js cannot sign it out', async () => {
    mockCheckSession.mockResolvedValue('rejected')
    // supabase-js keeps a session it can't load and answers sign-out with an error.
    const fake = fakeClient({ userId: 'u1', signOutFails: true })
    await render(
      <TestProviders client={fake.client}>
        <SessionProbe />
        <ProfileQuery queryFn={unauthenticated} />
      </TestProviders>,
    )

    expect(await screen.findByText('signed out')).toBeOnTheScreen()
    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
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

  it('saves the cache under the person it belongs to, and under the next person after a change', async () => {
    type Saved = { buster: string }
    const setItem = jest.mocked(AsyncStorage.setItem)
    const savedWith = (marker: string) => {
      // Earlier tests' throttled saves can still land, so look for this test's own data.
      const write = setItem.mock.calls.find(
        ([key, value]) => key === 'meoofy.queryCache' && value.includes(marker),
      )?.[1]
      if (write === undefined) throw new Error('not saved yet')
      return JSON.parse(write) as Saved
    }
    const fake = fakeClient({ userId: 'u1' })
    await render(
      <TestProviders client={fake.client}>
        <CacheProbe />
      </TestProviders>,
    )
    await waitFor(() => expect(restoringProbe).toBe(false))

    await act(async () => {
      cacheProbe?.setQueryData(['pets'], [{ id: 'owned-by-u1' }])
    })
    expect((await waitFor(() => savedWith('owned-by-u1'), { timeout: 3000 })).buster).toBe('u1')

    await act(async () => fake.signIn('u2'))
    await act(async () => {
      cacheProbe?.setQueryData(['pets'], [{ id: 'owned-by-u2' }])
    })
    expect((await waitFor(() => savedWith('owned-by-u2'), { timeout: 3000 })).buster).toBe('u2')
  })

  it('writes only the pets, entitlement and profile queries to disk, and no mutations', async () => {
    type Saved = { clientState: { queries: { queryKey: unknown[] }[]; mutations: unknown[] } }
    // Earlier tests' throttled saves can still land, so read this test's own writes.
    const setItem = jest.mocked(AsyncStorage.setItem)
    setItem.mockClear()
    const cacheWrites = () =>
      setItem.mock.calls.filter(([key]) => key === 'meoofy.queryCache').map(([, value]) => value)

    const fake = fakeClient({ userId: 'u1' })
    await render(
      <TestProviders client={fake.client}>
        <CacheProbe />
      </TestProviders>,
    )
    await waitFor(() => expect(restoringProbe).toBe(false))
    const queryClient = cacheProbe
    if (queryClient === null) throw new Error('expected the query client')

    await act(async () => onlineManager.setOnline(false))
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
      await act(async () => onlineManager.setOnline(true))
    }
  })

  it('keeps saved data on disk when a refresh of it fails, and leaves the failure out', async () => {
    type Saved = {
      clientState: { queries: { queryKey: unknown[]; state: { status: string; error: unknown } }[] }
    }
    const setItem = jest.mocked(AsyncStorage.setItem)
    const fake = fakeClient({ userId: 'u1' })
    await render(
      <TestProviders client={fake.client}>
        <CacheProbe />
      </TestProviders>,
    )
    await waitFor(() => expect(restoringProbe).toBe(false))
    const queryClient = cacheProbe
    if (queryClient === null) throw new Error('expected the query client')
    await act(async () => {
      queryClient.setQueryData(['pets'], [{ id: 'pet-refresh-failed' }])
    })

    // The connection drops in a way the device doesn't notice: the refresh fails.
    await act(async () => {
      await queryClient
        .fetchQuery({
          queryKey: ['pets'],
          queryFn: () => Promise.reject(new AppError('NETWORK')),
          retry: false,
        })
        .catch(() => undefined)
    })
    expect(queryClient.getQueryState(['pets'])?.status).toBe('error')
    setItem.mockClear()

    // The next save still holds the pets, as data that loaded, so the next start has them.
    const saved = await waitFor(
      () => {
        // Earlier tests' throttled saves can still land, so look for this test's pets.
        const write = setItem.mock.calls.find(
          ([key, value]) => key === 'meoofy.queryCache' && value.includes('pet-refresh-failed'),
        )?.[1]
        if (write === undefined) throw new Error('not saved yet')
        return JSON.parse(write) as Saved
      },
      { timeout: 3000 },
    )
    expect(saved.clientState.queries).toContainEqual(
      expect.objectContaining({
        queryKey: ['pets'],
        state: expect.objectContaining({ status: 'success', error: null }),
      }),
    )
    expect(saved.clientState.queries.every(({ state }) => state.error === null)).toBe(true)
  })
})
