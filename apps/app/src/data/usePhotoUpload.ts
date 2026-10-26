import { useCallback, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { randomUUID } from 'expo-crypto'
import { isPhotoLimitReached, uploadPhoto, type PetPhoto, type PhotoUpload } from '@meoofy/api'
import { parseAppError, type PhotoView } from '@meoofy/core'

import {
  preparePhoto,
  type PreparedPhoto,
  type PreparedRejection,
  type PrepareResult,
} from '../photo/preparePhoto'
import { confirmSession } from '../state/sessionCheck'
import { useSession } from '../state/SessionProvider'
import { readyPhotos, usePhotos } from './usePhotos'

/** Where a view's photo is: not there, being worked on, saved, or not saved. */
export type PhotoState = 'idle' | 'checking' | 'uploading' | 'ready' | 'error'

/** Why the last photo for a view was not added. */
export type PhotoProblem =
  // The device's check of the photo (core's `assessPhoto`), or the size limit.
  | PreparedRejection
  // The photo could not be read at all.
  | 'UNREADABLE'
  // From the server: it refused the photo, the person sent too many, or the request failed.
  | 'PHOTO_QUALITY'
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'UNKNOWN'
  // The server refused the upload slot because the pet already has as many photos as it may keep.
  | 'PHOTO_LIMIT'
  // The server refused the upload slot for any other reason (VALIDATION): the same id would be
  // refused again, for example the id of a deleted photo whose file is still queued (Ruling 26).
  | 'REFUSED'

/** Where sending the same photo again may work. The others need a new photo. */
const RETRYABLE: readonly PhotoProblem[] = ['NETWORK', 'RATE_LIMITED', 'UNKNOWN']

export function canRetry(problem: PhotoProblem | undefined): boolean {
  return problem !== undefined && RETRYABLE.includes(problem)
}

type Phase = 'checking' | 'uploading' | 'error'

/** A photo that was prepared and given an id, kept until it is saved or has to be replaced. */
type Attempt = { uri: string; id: string; photo: PreparedPhoto }

function problemFor(error: unknown): PhotoProblem {
  if (isPhotoLimitReached(error)) return 'PHOTO_LIMIT'
  const { code } = parseAppError(error)
  if (code === 'VALIDATION') return 'REFUSED'
  return code === 'PHOTO_QUALITY' || code === 'RATE_LIMITED' || code === 'NETWORK'
    ? code
    : 'UNKNOWN'
}

/** The list with `saved` as the photo of its view, the way the server now has it. */
function withSaved(photos: PetPhoto[] | undefined, saved: PetPhoto): PetPhoto[] {
  const others = (photos ?? []).filter(
    (photo) => photo.id !== saved.id && !(photo.view === saved.view && photo.status === 'ready'),
  )
  return [...others, saved]
}

/**
 * Adds reference photos to a pet: checks a photo on the device, then uploads it.
 *
 * - `state` says where each view's photo is: `checking` and `uploading` while a new one is worked
 *   on, otherwise `ready` if the view has a ready photo. A new photo that fails therefore leaves
 *   the view `ready` with its old photo (it is `error` only when there is none), and `problem`
 *   says what went wrong with the new one.
 * - `onSaved` is called with the view whose new photo has just been saved, and `onFailed` with the
 *   view and the problem when a photo is not added.
 * - Each new photo gets a fresh id (`expo-crypto`: Hermes has no Web Crypto global). When sending
 *   fails in a way that may pass (network, rate limit, anything unexpected) the prepared photo and
 *   its id are kept, and `retry` (or `upload` with the same `uri`) sends the same photo with the
 *   same id, which the server treats as one upload however often it arrives.
 * - A photo the server refuses (its quality, the photo limit, a refused upload slot) is not kept:
 *   the same photo with the same id would be refused again, so the person adds a photo again,
 *   which is a new attempt with a new id.
 * - A photo that is given up on (another one is chosen, or the server refuses it) may be left
 *   `pending` on the server. Nothing here deletes it: the server replaces a view's pending photo
 *   when the next photo for that view is requested (Ruling 54), so it never fills the pet's photo
 *   limit, and cleanup removes whatever is left a day later.
 */
export function usePhotoUpload(
  petId: string,
  {
    onSaved,
    onFailed,
  }: {
    onSaved?: (view: PhotoView) => void
    onFailed?: (view: PhotoView, problem: PhotoProblem) => void
  } = {},
) {
  const { client } = useSession()
  const queryClient = useQueryClient()
  const photos = usePhotos(petId)
  const [phase, setPhase] = useState<Partial<Record<PhotoView, Phase>>>({})
  const [problem, setProblem] = useState<Partial<Record<PhotoView, PhotoProblem>>>({})
  const attempts = useRef(new Map<PhotoView, Attempt>())
  // A ref, not state: two presses can arrive before a re-render.
  const running = useRef(new Set<PhotoView>())
  const onSavedRef = useRef(onSaved)
  onSavedRef.current = onSaved
  const onFailedRef = useRef(onFailed)
  onFailedRef.current = onFailed

  const send = useMutation({
    // Ask the server even when the device believes it is offline: a failure is reported at once,
    // where the default would hold the request and leave the screen waiting.
    networkMode: 'always',
    // Names the operation when an unexpected failure is reported (QueryProvider's MutationCache).
    mutationKey: ['uploadPhoto'],
    mutationFn: (photo: PhotoUpload) => uploadPhoto(client, photo),
    onSuccess: (saved) => {
      // The new photo shows at once; the refresh then confirms the server's list.
      queryClient.setQueryData<PetPhoto[]>(['photos', saved.petId], (old) => withSaved(old, saved))
      void queryClient.invalidateQueries({ queryKey: ['photos', saved.petId] })
    },
  })
  const { mutateAsync } = send

  const upload = useCallback(
    async (view: PhotoView, uri: string): Promise<void> => {
      if (running.current.has(view)) return
      running.current.add(view)
      const show = (next: Phase | undefined) => setPhase((all) => ({ ...all, [view]: next }))
      const fail = (why: PhotoProblem) => {
        setProblem((all) => ({ ...all, [view]: why }))
        show('error')
        onFailedRef.current?.(view, why)
      }
      /** Gives up on the photo kept for the view: the next one is a new attempt with a new id. */
      const abandon = () => {
        attempts.current.delete(view)
      }
      setProblem((all) => {
        const rest = { ...all }
        delete rest[view]
        return rest
      })

      try {
        let attempt = attempts.current.get(view)
        if (attempt?.uri !== uri) {
          abandon()
          show('checking')
          let prepared: PrepareResult
          try {
            prepared = await preparePhoto(uri)
          } catch {
            return fail('UNREADABLE')
          }
          if (!prepared.ok) return fail(prepared.reason)
          const { jpeg, width, height, brightness, blurScore } = prepared
          attempt = { uri, id: randomUUID(), photo: { jpeg, width, height, brightness, blurScore } }
          attempts.current.set(view, attempt)
        }

        show('uploading')
        try {
          await mutateAsync({ id: attempt.id, petId, view, ...attempt.photo })
        } catch (e) {
          const why = problemFor(e)
          // A photo the server refused would be refused again, so it is not kept for a retry.
          if (!canRetry(why)) abandon()
          // The session may be gone, or a refresh may only have failed for a moment: Auth decides,
          // and a refused session signs out, which leads the screen to sign-in.
          if (parseAppError(e).code === 'UNAUTHENTICATED') void confirmSession(client, e)
          return fail(why)
        }
        attempts.current.delete(view)
        show(undefined)
        onSavedRef.current?.(view)
      } finally {
        running.current.delete(view)
      }
    },
    [client, mutateAsync, petId],
  )

  /** Sends the photo that failed for `view` again, with the same id. */
  const retry = useCallback(
    async (view: PhotoView): Promise<void> => {
      const attempt = attempts.current.get(view)
      if (attempt !== undefined) await upload(view, attempt.uri)
    },
    [upload],
  )

  const state = useMemo(() => {
    const ready = readyPhotos(photos.data)
    const states = { front: 'idle', side: 'idle', markings: 'idle', extra: 'idle' } as Record<
      PhotoView,
      PhotoState
    >
    for (const view of Object.keys(states) as PhotoView[]) {
      const current = phase[view]
      states[view] =
        current === 'checking' || current === 'uploading'
          ? current
          : ready[view] !== undefined
            ? 'ready'
            : current === 'error'
              ? 'error'
              : 'idle'
    }
    return states
  }, [phase, photos.data])

  return { upload, retry, state, problem }
}
