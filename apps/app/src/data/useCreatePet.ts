import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { randomUUID } from 'expo-crypto'
import { createPet } from '@pawpin/api'
import type { PetInput } from '@pawpin/core'

import { useSession } from '../state/SessionProvider'

/**
 * Adds a pet. The id is made once when the form opens (`expo-crypto`: Hermes has no Web Crypto
 * global) and used for every attempt, so a retry after a lost answer reaches the server's
 * idempotent create and returns the same pet instead of adding a second one.
 */
export function useCreatePet() {
  const { client } = useSession()
  const queryClient = useQueryClient()
  const [id] = useState(() => randomUUID())
  return useMutation({
    // Ask the server even when the device believes it is offline: a failure is reported at once,
    // where the default would hold the request and leave the screen waiting.
    networkMode: 'always',
    // Names the operation when an unexpected failure is reported (QueryProvider's MutationCache).
    mutationKey: ['createPet'],
    mutationFn: (basics: Omit<PetInput, 'id'>) => createPet(client, { ...basics, id }),
    onSuccess: () => {
      // The list and the pet count change; whatever is on screen refreshes in the background.
      void queryClient.invalidateQueries({ queryKey: ['pets'] })
      void queryClient.invalidateQueries({ queryKey: ['entitlement'] })
    },
  })
}
