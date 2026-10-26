import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Platform } from 'react-native'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { MutationCache, QueryCache, QueryClient, type QueryKey } from '@tanstack/react-query'
import {
  PersistQueryClientProvider,
  type PersistedClient,
} from '@tanstack/react-query-persist-client'
import { parseAppError } from '@meoofy/core'

import { reportHandledError } from '../observability/sentry'
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

/** What a failed query or mutation is called in an error report: its key's root, a fixed word. */
function operationOf(key: QueryKey | undefined): string {
  const root = key?.[0]
  return typeof root === 'string' ? root : 'unknown'
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** After a refreshed session, a failed read is asked again at most once in this window. */
const RECOVERY_WINDOW_MS = 30_000

/** Where the persister keeps the cache on the device. */
export const QUERY_CACHE_KEY = 'meoofy.queryCache'

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
 * - a read or write that fails unexpectedly (UNKNOWN) is sent to Sentry,
 *   stripped of its message (`reportHandledError`, spec §9);
 * - a read that fails with UNAUTHENTICATED is checked with Auth
 *   (`confirmSession`): a refused session signs out locally and the tab layout
 *   routes to sign-in; a session that refreshed fine gets the read asked once
 *   more; when Auth can't be reached nothing changes;
 * - when the signed-in user changes, the previous user's cache and add-pet
 *   draft are dropped;
 * - the saved cache records whose it is; one saved for someone else is
 *   dropped instead of restored;
 * - when supabase-js gets hold of a session the app had opened without
 *   (offline), the reads on screen are asked again;
 * - on iOS, reads refresh when the app comes back to the front.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const { client, userId, clientHasSession } = useSession()

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
          reportHandledError(error, operationOf(query.queryKey))
          if (parseAppError(error).code !== 'UNAUTHENTICATED') return
          void confirmSession(client, error).then((outcome) => {
            if (outcome === 'valid' && mayRecover(query.queryHash)) {
              void created.invalidateQueries({ queryKey: query.queryKey, exact: true })
            }
          })
        },
      }),
      // A write made through a mutation (each has a key naming it) is reported here, once,
      // whatever the screen then shows. Writes called directly report themselves.
      mutationCache: new MutationCache({
        onError: (error, _variables, _result, mutation) => {
          reportHandledError(error, operationOf(mutation.options.mutationKey))
        },
      }),
      defaultOptions: {
        queries: { retry: retryQuery, gcTime: WEEK_MS },
      },
    })
    return created
  })

  // Whose cache is being saved. It is the persister's `buster`: a restore keeps only a cache saved
  // with the buster it is given, the person the app opens for. (A save can land after the person
  // changed, so it is stamped when written, not with the restore-time value.)
  const owner = useRef(userId)
  const [persister] = useState(() =>
    createAsyncStoragePersister({
      storage: storageFor(Platform.OS),
      key: QUERY_CACHE_KEY,
      serialize: (client) => JSON.stringify({ ...savedData(client), buster: owner.current ?? '' }),
    }),
  )

  useEffect(() => followAppFocus(), [])

  const previous = useRef({ userId, clientHasSession })
  useEffect(() => {
    const before = previous.current
    previous.current = { userId, clientHasSession }
    if (before.userId !== userId) {
      queryClient.clear()
      // From here on, saves are the new person's (the save of the cleared cache included).
      owner.current = userId
      // The draft belongs to the person who wrote it.
      void clearDraft().catch(() => undefined)
    } else if (!before.clientHasSession && clientHasSession) {
      // Reads made before Auth refreshed the session may have been refused; one already under way
      // is kept rather than sent again.
      void queryClient.invalidateQueries(undefined, { cancelRefetch: false })
    }
  }, [queryClient, userId, clientHasSession])

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: WEEK_MS,
        buster: userId ?? '',
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
