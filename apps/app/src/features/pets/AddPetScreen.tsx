import { useEffect, useState } from 'react'
import { Redirect, router, useLocalSearchParams } from 'expo-router'

import { useCreatePet } from '../../data/useCreatePet'
import { usePet } from '../../data/usePet'
import { useUpdatePet } from '../../data/useUpdatePet'
import { clearDraft, loadDraft, saveDraft, type PetDraft } from '../../offline/draft'
import { useSession } from '../../state/SessionProvider'
import { stepBack } from '../onboarding/progress'
import { petsCopy as copy } from './copy'
import { PetForm } from './PetForm'
import { changesTo, valuesOf } from './petFormValues'
import { PetUnavailable } from './PetProfileScreen'

/** O03: the basics of a new pet. Saving creates it and opens the photos step. */
export function AddPetScreen() {
  const { signedIn } = useSession()
  const create = useCreatePet()
  const [draft, setDraft] = useState<PetDraft | null>(null)

  useEffect(() => {
    let active = true
    // A draft that can't be read is the same as none.
    loadDraft()
      .then((saved) => {
        if (active) setDraft(saved)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  if (!signedIn) return <Redirect href="/(auth)/sign-in" />

  return (
    <PetForm
      title={copy.add.title}
      step={copy.add.step}
      actionLabel={copy.add.action}
      initial={draft ?? {}}
      showPrivacy
      onBack={() => stepBack('/(tabs)/home')}
      onSubmit={async (basics) => {
        const pet = await create.mutateAsync(basics)
        // The pet exists now; a draft of it would only come back as a stale form.
        void clearDraft().catch(() => undefined)
        return () => router.replace(`/pets/${pet.id}/photos`)
      }}
      onSaveDraft={saveDraft}
    />
  )
}

/** The same form for a pet that exists: filled in, and saving sends only what changed. */
export function EditPetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { signedIn } = useSession()
  const pet = usePet(id)
  const update = useUpdatePet()

  if (!signedIn) return <Redirect href="/(auth)/sign-in" />
  if (pet.data == null) return <PetUnavailable pet={pet} />

  const current = pet.data
  const back = () => stepBack(`/pets/${current.id}`)
  return (
    <PetForm
      title={copy.edit.title(current.name)}
      actionLabel={copy.edit.action}
      initial={valuesOf(current)}
      showPrivacy={false}
      onBack={back}
      onSubmit={async (basics) => {
        const patch = changesTo(current, basics)
        if (Object.keys(patch).length > 0) await update.mutateAsync({ id: current.id, patch })
        return back
      }}
    />
  )
}
