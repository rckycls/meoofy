import AsyncStorage from '@react-native-async-storage/async-storage'
import { QueryClient, dehydrate, type QueryKey } from '@tanstack/react-query'

import { QUERY_CACHE_KEY } from '../state/QueryProvider'

/**
 * Writes `entries` to the device the way the app's persister saves the query cache, as if an
 * earlier session of `owner` had loaded them. The app restores them when it next opens for them.
 */
export async function seedPersistedCache(
  entries: readonly [QueryKey, unknown][],
  { owner = 'u1' }: { owner?: string } = {},
): Promise<void> {
  const client = new QueryClient()
  for (const [queryKey, data] of entries) client.setQueryData(queryKey, data)
  const saved = { buster: owner, timestamp: Date.now(), clientState: dehydrate(client) }
  client.clear()
  await AsyncStorage.setItem(QUERY_CACHE_KEY, JSON.stringify(saved))
}
