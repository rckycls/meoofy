import { useQuery } from '@tanstack/react-query'
import { getEntitlement } from '@pawpin/api'

import { useSession } from '../state/SessionProvider'

/** The signed-in owner's plan, its pet limit and their pet count. Persisted under `['entitlement']`. */
export function useEntitlement() {
  const { client, signedIn } = useSession()
  return useQuery({
    queryKey: ['entitlement'],
    queryFn: () => getEntitlement(client),
    enabled: signedIn,
  })
}
