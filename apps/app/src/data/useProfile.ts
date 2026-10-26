import { useQuery } from '@tanstack/react-query'
import { getProfile } from '@meoofy/api'

import { useSession } from '../state/SessionProvider'

/**
 * The signed-in person's profile. Shares `['profile']` (persisted, and also read by the entry
 * gate and the name step) so every screen sees one copy.
 */
export function useProfile() {
  const { client, signedIn } = useSession()
  return useQuery({ queryKey: ['profile'], queryFn: () => getProfile(client), enabled: signedIn })
}
