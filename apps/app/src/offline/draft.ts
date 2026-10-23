import { speciesSchema, type Species } from '@pawpin/core'

import { local } from '../storage/local'

/** The add-pet form as typed: each field is its raw text. */
export type PetDraft = Partial<{
  name: string
  species: Species
  breed: string
  years: string
  months: string
}>

const KEY = 'pawpin.petDraft'
const TEXT_FIELDS = ['name', 'breed', 'years', 'months'] as const
const FIELDS: readonly string[] = [...TEXT_FIELDS, 'species']

/** The draft's own fields, or `null` for anything else: not an object, a stranger field, a wrong type. */
function readDraft(value: unknown): PetDraft | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const fields = value as Record<string, unknown>
  if (Object.keys(fields).some((key) => !FIELDS.includes(key))) return null
  const draft: PetDraft = {}
  for (const key of TEXT_FIELDS) {
    const text = fields[key]
    if (text === undefined) continue
    if (typeof text !== 'string') return null
    draft[key] = text
  }
  if (fields.species !== undefined) {
    const species = speciesSchema.safeParse(fields.species)
    if (!species.success) return null
    draft.species = species.data
  }
  return draft
}

/** Keeps the unfinished add-pet form on this device (AsyncStorage on iOS, localStorage on the web). */
export async function saveDraft(d: PetDraft): Promise<void> {
  const draft: PetDraft = {}
  for (const key of TEXT_FIELDS) if (typeof d[key] === 'string') draft[key] = d[key]
  if (d.species !== undefined) draft.species = d.species
  await local.set(KEY, JSON.stringify(draft))
}

/**
 * The saved add-pet form, or `null` when there is none. A draft that can't be read (not JSON, or
 * the shape of another version) is forgotten rather than shown half right.
 */
export async function loadDraft(): Promise<PetDraft | null> {
  const raw = await local.get(KEY)
  if (raw === null) return null
  let draft: PetDraft | null = null
  try {
    draft = readDraft(JSON.parse(raw))
  } catch {
    // Not JSON: the same as a draft of the wrong shape.
  }
  if (draft === null) await local.remove(KEY).catch(() => undefined)
  return draft
}

/** Forgets the saved add-pet form: the pet was created, or the person who wrote it signed out. */
export async function clearDraft(): Promise<void> {
  await local.remove(KEY)
}
