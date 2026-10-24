import { useMutation, useQueryClient } from '@tanstack/react-query'
import { updatePet } from '@pawpin/api'
import type { PetPatch } from '@pawpin/core'

import { useSession } from '../state/SessionProvider'

/** Changes the given fields of a pet. The saved pet replaces its cached copy; the list is refreshed. */
export function useUpdatePet() {
  const { client } = useSession()
  const queryClient = useQueryClient()
  return useMutation({
    // Ask the server even when the device believes it is offline: a failure is reported at once,
    // where the default would hold the request and leave the screen waiting.
    networkMode: 'always',
    // Names the operation when an unexpected failure is reported (QueryProvider's MutationCache).
    mutationKey: ['updatePet'],
    mutationFn: ({ id, patch }: { id: string; patch: PetPatch }) => updatePet(client, id, patch),
    onSuccess: (pet) => {
      queryClient.setQueryData(['pet', pet.id], pet)
      void queryClient.invalidateQueries({ queryKey: ['pets'] })
    },
  })
}
