import { Text } from 'react-native'
import { act, render, screen, waitFor } from '@testing-library/react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as SecureStore from 'expo-secure-store'
import { AppError } from '@pawpin/core'

import { fakeClient } from '../testing/fakeClient'
import { TestProviders } from '../testing/TestRoot'
import { retryQuery, shouldPersistQuery } from './QueryProvider'
import { sessionStorageFor, useSession } from './SessionProvider'

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

function FailingQuery({ error }: { error: Error }) {
  const query = useQuery({
    queryKey: ['profile'],
    queryFn: () => Promise.reject(error),
    retry: false,
  })
  return <Text>{query.status}</Text>
}

let cacheProbe: ReturnType<typeof useQueryClient> | null = null
function CacheProbe() {
  cacheProbe = useQueryClient()
  return null
}

describe('QueryProvider', () => {
  it('signs out locally when a read says the session is gone', async () => {
    const fake = fakeClient({ userId: 'u1' })
    await render(
      <TestProviders client={fake.client}>
        <FailingQuery error={new AppError('UNAUTHENTICATED')} />
      </TestProviders>,
    )

    await waitFor(() => expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' }))
  })

  it('keeps the session on other read failures', async () => {
    const fake = fakeClient({ userId: 'u1' })
    await render(
      <TestProviders client={fake.client}>
        <FailingQuery error={new AppError('UNKNOWN')} />
      </TestProviders>,
    )

    expect(await screen.findByText('error')).toBeOnTheScreen()
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
})
