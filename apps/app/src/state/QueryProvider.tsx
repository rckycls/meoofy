import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import {
  QueryCache,
  QueryClient,
  defaultShouldDehydrateQuery,
  type QueryKey,
} from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { parseAppError } from '@pawpin/core'

import { confirmSession } from './sessionCheck'
import { useSession } from './SessionProvider'

/** Network and rate-limit failures retry up to 3 times (with the default backoff); typed errors never do. */
export function retryQuery(failureCount: number, error: unknown): boolean {
  return failureCount < 3 && parseAppError(error).retryable
}

/** Offline reads keep the pets list, the plan and the profile; nothing else is written to disk. */
const PERSISTED_KEYS: readonly string[] = ['pets', 'entitlement', 'profile']

export function shouldPersistQuery(queryKey: QueryKey): boolean {
  const [root] = queryKey
  return queryKey.length === 1 && typeof root === 'string' && PERSISTED_KEYS.includes(root)
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** After a refreshed session, a failed read is asked again at most once in this window. */
const RECOVERY_WINDOW_MS = 30_000

function persistStorage() {
  if (Platform.OS !== 'web') return AsyncStorage
  // No window while the web build renders on the server: nothing to restore.
  return typeof window === 'undefined' ? undefined : window.localStorage
}

/**
 * TanStack Query with the cache persisted for offline reads (AsyncStorage on
 * iOS, localStorage on the web). Must sit inside `SessionProvider`:
 * - a read that fails with UNAUTHENTICATED is checked with Auth
 *   (`confirmSession`): a refused session signs out locally and the tab layout
 *   routes to sign-in; a session that refreshed fine gets the read asked once
 *   more; when Auth can't be reached nothing changes;
 * - when the signed-in user changes, the previous user's cache is dropped.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const { client, userId } = useSession()

  const [queryClient] = useState(() => {
    const lastRecovery = new Map<string, number>()
    const mayRecover = (queryHash: string) => {
      const now = Date.now()
      const last = lastRecovery.get(queryHash)
      if (last !== undefined && now - last < RECOVERY_WINDOW_MS) return false
      lastRecovery.set(queryHash, now)
      return true
    }

    const created: QueryClient = new QueryClient({
      queryCache: new QueryCache({
        onError: (error, query) => {
          if (parseAppError(error).code !== 'UNAUTHENTICATED') return
          void confirmSession(client, error).then((outcome) => {
            if (outcome === 'valid' && mayRecover(query.queryHash)) {
              void created.invalidateQueries({ queryKey: query.queryKey, exact: true })
            }
          })
        },
      }),
      defaultOptions: {
        queries: { retry: retryQuery, gcTime: WEEK_MS },
      },
    })
    return created
  })

  const [persister] = useState(() =>
    createAsyncStoragePersister({ storage: persistStorage(), key: 'pawpin.queryCache' }),
  )

  const previousUser = useRef(userId)
  useEffect(() => {
    if (previousUser.current === userId) return
    previousUser.current = userId
    queryClient.clear()
  }, [queryClient, userId])

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: WEEK_MS,
        dehydrateOptions: {
          shouldDehydrateQuery: (query) =>
            defaultShouldDehydrateQuery(query) && shouldPersistQuery(query.queryKey),
          // TanStack would also save paused mutations, variables (pet details) included.
          shouldDehydrateMutation: () => false,
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  )
}
