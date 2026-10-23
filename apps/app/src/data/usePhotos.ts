import { useQuery } from '@tanstack/react-query'
import { listPhotos, type PetPhoto } from '@pawpin/api'
import type { PhotoView } from '@pawpin/core'

import { useSession } from '../state/SessionProvider'

/** A pet's photos, of every status. The key is not persisted: signed URLs last an hour. */
export function usePhotos(petId: string) {
  const { client, signedIn } = useSession()
  return useQuery({
    queryKey: ['photos', petId],
    queryFn: () => listPhotos(client, petId),
    enabled: signedIn,
  })
}

/**
 * The photo to show for each view: its newest `ready` one. A pending or rejected photo is not one
 * to show, so it never takes the place of a ready photo. (The list is oldest first.)
 */
export function readyPhotos(
  photos: readonly PetPhoto[] | undefined,
): Partial<Record<PhotoView, PetPhoto>> {
  const byView: Partial<Record<PhotoView, PetPhoto>> = {}
  for (const photo of photos ?? []) {
    if (photo.status === 'ready') byView[photo.view] = photo
  }
  return byView
}
