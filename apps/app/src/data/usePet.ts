import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getPet, type Pet } from '@pawpin/api'

import { useSession } from '../state/SessionProvider'

/**
 * One of the signed-in owner's pets, or `null` when they have none with that id. The key is not
 * persisted (only single-element keys are), so a profile opens from the cached `['pets']` list:
 * that entry seeds the query and the server is asked again for a fresh copy.
 */
export function usePet(id: string) {
  const { client, signedIn } = useSession()
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: ['pet', id],
    queryFn: () => getPet(client, id),
    enabled: signedIn,
    initialData: (): Pet | undefined =>
      queryClient.getQueryData<Pet[]>(['pets'])?.find((pet) => pet.id === id),
    initialDataUpdatedAt: () => queryClient.getQueryState(['pets'])?.dataUpdatedAt,
  })
}
