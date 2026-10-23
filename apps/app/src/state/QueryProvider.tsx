import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Platform } from 'react-native'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { QueryCache, QueryClient, type QueryKey } from '@tanstack/react-query'
import {
  PersistQueryClientProvider,
  type PersistedClient,
} from '@tanstack/react-query-persist-client'
import { parseAppError } from '@pawpin/core'

import { clearDraft } from '../offline/draft'
import { storageFor } from '../storage/local'
import { followAppFocus } from './appFocus'
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

/** Where the persister keeps the cache on the device. */
export const QUERY_CACHE_KEY = 'pawpin.queryCache'

/**
 * What is saved of a query is its data. A refresh that failed (a connection that dropped without
 * the device noticing) leaves the query in `error` with its data still good; it is saved as that
 * data, so the next start shows it, and the failure itself is not kept.
 */
function savedData(client: PersistedClient): PersistedClient {
  const queries = client.clientState.queries.map((query) =>
    query.state.status === 'error'
      ? {
          ...query,
          state: {
            ...query.state,
            status: 'success' as const,
            error: null,
            fetchFailureCount: 0,
            fetchFailureReason: null,
          },
        }
      : query,
  )
  return { ...client, clientState: { ...client.clientState, queries } }
}

/**
 * TanStack Query with the cache persisted for offline reads (AsyncStorage on
 * iOS, localStorage on the web; nothing while the web build renders on the
 * server). Must sit inside `SessionProvider`:
 * - a read that fails with UNAUTHENTICATED is checked with Auth
 *   (`confirmSession`): a refused session signs out locally and the tab layout
 *   routes to sign-in; a session that refreshed fine gets the read asked once
 *   more; when Auth can't be reached nothing changes;
 * - when the signed-in user changes, the previous user's cache and add-pet
 *   draft are dropped;
 * - when Auth confirms a session the app had opened on unconfirmed (offline),
 *   the reads on screen are asked again;
 * - on iOS, reads refresh when the app comes back to the front.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const { client, userId, verified } = useSession()

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
    createAsyncStoragePersister({
      storage: storageFor(Platform.OS),
      key: QUERY_CACHE_KEY,
      serialize: (client) => JSON.stringify(savedData(client)),
    }),
  )

  useEffect(() => followAppFocus(), [])

  const previous = useRef({ userId, verified })
  useEffect(() => {
    const before = previous.current
    previous.current = { userId, verified }
    if (before.userId !== userId) {
      queryClient.clear()
      // The draft belongs to the person who wrote it.
      void clearDraft().catch(() => undefined)
    } else if (!before.verified && verified) {
      // Reads made before Auth refreshed the session may have been refused; one already under way
      // is kept rather than sent again.
      void queryClient.invalidateQueries(undefined, { cancelRefetch: false })
    }
  }, [queryClient, userId, verified])

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: WEEK_MS,
        dehydrateOptions: {
          // Any of the three that holds data, including one whose last refresh failed.
          shouldDehydrateQuery: (query) =>
            query.state.data !== undefined && shouldPersistQuery(query.queryKey),
          // TanStack would also save paused mutations, variables (pet details) included.
          shouldDehydrateMutation: () => false,
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  )
}
