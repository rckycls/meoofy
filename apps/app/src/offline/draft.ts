import type { Species } from '@pawpin/core'

/** The add-pet form as typed: each field is its raw text. */
export type PetDraft = Partial<{
  name: string
  species: Species
  breed: string
  years: string
  months: string
}>

// A placeholder until the offline work stores drafts on the device: Task 22 replaces these
// bodies in place, so the add-pet form already calls the final signatures.

/** Keeps the unfinished add-pet form on this device. */
export async function saveDraft(d: PetDraft): Promise<void> {
  void d
}

/** The saved add-pet form, or `null` when there is none. */
export async function loadDraft(): Promise<PetDraft | null> {
  return null
}

/** Forgets the saved add-pet form (the pet was created). */
export async function clearDraft(): Promise<void> {}
