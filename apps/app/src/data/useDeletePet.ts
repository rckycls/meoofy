import { useMutation, useQueryClient } from '@tanstack/react-query'
import { deletePet } from '@pawpin/api'

import { useSession } from '../state/SessionProvider'

/** Deletes a pet. The list and the pet count are refreshed, and the pet's own copy is dropped. */
export function useDeletePet() {
  const { client } = useSession()
  const queryClient = useQueryClient()
  return useMutation({
    // Ask the server even when the device believes it is offline: a failure is reported at once,
    // where the default would hold the request and leave the screen waiting.
    networkMode: 'always',
    // Names the operation when an unexpected failure is reported (QueryProvider's MutationCache).
    mutationKey: ['deletePet'],
    mutationFn: (id: string) => deletePet(client, id),
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: ['pet', id], exact: true })
      void queryClient.invalidateQueries({ queryKey: ['pets'] })
      void queryClient.invalidateQueries({ queryKey: ['entitlement'] })
    },
  })
}
