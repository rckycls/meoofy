import { useQuery } from '@tanstack/react-query'
import { listPets } from '@meoofy/api'

import { useSession } from '../state/SessionProvider'

/** The signed-in owner's pets. The key is persisted for offline reads, so it stays `['pets']`. */
export function usePets() {
  const { client, signedIn } = useSession()
  return useQuery({ queryKey: ['pets'], queryFn: () => listPets(client), enabled: signedIn })
}
