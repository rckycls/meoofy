import { useEffect, useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { Redirect, router, useLocalSearchParams } from 'expo-router'
import type { Pet } from '@pawpin/api'
import {
  codePointLength,
  parseAppError,
  petInputSchema,
  petLimit,
  speciesSchema,
  type AppError,
  type PetInput,
  type PetPatch,
  type Species,
} from '@pawpin/core'
import {
  Button,
  Card,
  Field,
  ScreenShell,
  Sticker,
  cardRoles,
  colors,
  radii,
  space,
  textStyle,
  type,
} from '@pawpin/ui'

import { useCreatePet } from '../../data/useCreatePet'
import { usePet } from '../../data/usePet'
import { useUpdatePet } from '../../data/useUpdatePet'
import { ContentColumn } from '../../layout/ContentColumn'
import { clearDraft, loadDraft, saveDraft, type PetDraft } from '../../offline/draft'
import { confirmSession } from '../../state/sessionCheck'
import { useSession } from '../../state/SessionProvider'
import { ProblemNote } from '../auth/ProblemNote'
import { TextLink } from '../auth/TextLink'
import { stepBack } from '../onboarding/progress'
import { AgeInput, parseAge, type AgeErrors } from './AgeInput'
import { petsCopy as copy } from './copy'
import { PetUnavailable } from './PetProfileScreen'

/** The form as typed: every field is its raw text. */
type Values = { name: string; species: Species; breed: string; years: string; months: string }
type FieldErrors = AgeErrors & { name?: string; breed?: string }
/** What a valid form holds: a trimmed name, a breed or `null`, and the age in months or `null`. */
type Basics = Omit<PetInput, 'id'>

const EMPTY: Values = { name: '', species: 'dog', breed: '', years: '', months: '' }

// The id belongs to the create call (it is made once per form), not to the form's fields.
const basicsSchema = petInputSchema.omit({ id: true })

/** The errors a field's edit makes out of date: a change to one age box clears both age errors. */
const clearedBy: Record<keyof Values, readonly (keyof FieldErrors)[]> = {
  name: ['name'],
  species: [],
  breed: ['breed'],
  years: ['years', 'months'],
  months: ['years', 'months'],
}

function readBasics(
  values: Values,
): { ok: true; basics: Basics } | { ok: false; errors: FieldErrors } {
  const age = parseAge(values.years, values.months)
  const errors: FieldErrors = age.ok ? {} : { ...age.errors }
  const parsed = basicsSchema.safeParse({
    name: values.name,
    species: values.species,
    breed: values.breed,
    ageMonths: age.ok ? age.ageMonths : null,
  })
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      if (issue.path[0] === 'name') {
        errors.name =
          codePointLength(values.name.trim()) === 0
            ? copy.errors.nameRequired
            : copy.errors.nameTooLong
      } else if (issue.path[0] === 'breed') {
        errors.breed = copy.errors.breedTooLong
      }
    }
  }
  return parsed.success && age.ok ? { ok: true, basics: parsed.data } : { ok: false, errors }
}

type PetFormProps = {
  title: string
  /** "Step 1 of 3 · Basics" while adding. */
  step?: string
  actionLabel: string
  /** Where the fields start. A field the person hasn't touched follows it if it changes later. */
  initial: Partial<Values>
  showPrivacy: boolean
  onBack: () => void
  /**
   * Saves valid details. Resolves with how to leave the form, which is skipped if the person has
   * already left it (Back while the request was in flight). Rejects with whatever went wrong.
   */
  onSubmit: (basics: Basics) => Promise<() => void>
  /** Keeps the form as it is on the device (adding only). */
  onSaveDraft?: (values: Values) => Promise<void>
}

/** The pet basics form of O03, for adding a pet and for editing one. */
function PetForm({
  title,
  step,
  actionLabel,
  initial,
  showPrivacy,
  onBack,
  onSubmit,
  onSaveDraft,
}: PetFormProps) {
  const { client } = useSession()
  const [edits, setEdits] = useState<Partial<Values>>({})
  const values: Values = { ...EMPTY, ...initial, ...edits }
  const [errors, setErrors] = useState<FieldErrors>({})
  const [problem, setProblem] = useState<AppError | null>(null)
  const [draftNote, setDraftNote] = useState<'saved' | 'failed' | null>(null)
  const [saving, setSaving] = useState(false)
  // One submit at a time. A ref, not state: two presses can arrive before a re-render.
  const working = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  function change<K extends keyof Values>(key: K, value: Values[K]) {
    setEdits((current) => ({ ...current, [key]: value }))
    setErrors((current) => {
      const next = { ...current }
      for (const cleared of clearedBy[key]) delete next[cleared]
      return next
    })
    setDraftNote(null)
  }

  async function submit() {
    if (working.current) return
    const read = readBasics(values)
    if (!read.ok) {
      setErrors(read.errors)
      return
    }
    setErrors({})
    setProblem(null)
    working.current = true
    setSaving(true)
    try {
      const leave = await onSubmit(read.basics)
      // The screen is being left; `saving` stays on so nothing can be sent twice.
      if (mounted.current) leave()
    } catch (e) {
      const error = parseAppError(e)
      // UNAUTHENTICATED can mean the session is gone or only that a refresh failed for a moment.
      // Auth decides: a refused session signs out, and the screen then leads to sign-in.
      if (error.code === 'UNAUTHENTICATED') void confirmSession(client, e)
      setProblem(error)
      setSaving(false)
      working.current = false
    }
  }

  async function saveAsDraft() {
    if (onSaveDraft === undefined) return
    try {
      await onSaveDraft(values)
      setDraftNote('saved')
    } catch {
      setDraftNote('failed')
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenShell flow="owner" scroll>
        <ContentColumn style={styles.column}>
          <View style={styles.back}>
            <TextLink label={copy.back} onPress={onBack} />
          </View>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            {step === undefined ? null : <Text style={styles.step}>{step}</Text>}
          </View>
          <View style={styles.fields}>
            <Field
              label={copy.fields.name}
              value={values.name}
              onChangeText={(name) => change('name', name)}
              error={errors.name}
              autoCapitalize="words"
              returnKeyType="next"
            />
            <SpeciesPicker
              value={values.species}
              onChange={(species) => change('species', species)}
            />
            <Field
              label={copy.fields.breed}
              value={values.breed}
              onChangeText={(breed) => change('breed', breed)}
              error={errors.breed}
              autoCapitalize="sentences"
            />
            <AgeInput
              years={values.years}
              months={values.months}
              onChangeYears={(years) => change('years', years)}
              onChangeMonths={(months) => change('months', months)}
              errors={errors}
            />
          </View>
          {showPrivacy ? (
            <Card role="privacy" title={copy.add.privacy.title}>
              {copy.add.privacy.body}
            </Card>
          ) : null}
          {problem === null ? null : <ProblemView error={problem} />}
          <Button
            variant="primary"
            label={actionLabel}
            loading={saving}
            onPress={() => void submit()}
          />
          {onSaveDraft === undefined ? null : (
            <Button
              variant="secondary"
              label={copy.add.saveDraft}
              onPress={() => void saveAsDraft()}
            />
          )}
          {draftNote === 'saved' ? (
            <Text accessibilityLiveRegion="polite" style={styles.draftNote}>
              {copy.add.draftSaved}
            </Text>
          ) : null}
          {draftNote === 'failed' ? <ProblemNote>{copy.add.draftFailed}</ProblemNote> : null}
        </ContentColumn>
      </ScreenShell>
    </KeyboardAvoidingView>
  )
}

/** Dog or cat. A radio group: one is always chosen, and it says which. */
function SpeciesPicker({
  value,
  onChange,
}: {
  value: Species
  onChange: (species: Species) => void
}) {
  return (
    <View style={styles.speciesGroup}>
      <Text style={styles.label}>{copy.fields.species}</Text>
      <View
        accessibilityRole="radiogroup"
        aria-label={copy.fields.species}
        style={styles.speciesRow}
      >
        {speciesSchema.options.map((species) => {
          const selected = species === value
          return (
            <Pressable
              key={species}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              onPress={() => onChange(species)}
              style={[styles.option, selected ? styles.optionSelected : styles.optionIdle]}
            >
              <Sticker name={species} size={40} />
              <Text style={styles.optionLabel}>{copy.species[species]}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

/** Why saving failed: the plan is full (with a way to compare plans), or a plain sentence. */
function ProblemView({ error }: { error: AppError }) {
  if (error.code === 'PET_LIMIT_REACHED') {
    return (
      <View testID="pet-limit" role="alert" accessibilityLiveRegion="polite">
        <Card role="community" title={copy.limit.title}>
          <Text style={[styles.limitBody, { color: cardRoles.community.body }]}>
            {copy.limit.body(petLimit('free'))}
          </Text>
          <TextLink label={copy.limit.comparePlans} onPress={() => router.push('/plans')} />
        </Card>
      </View>
    )
  }
  return (
    <ProblemNote>
      {error.code === 'NETWORK'
        ? copy.problems.offline
        : error.code === 'VALIDATION'
          ? copy.problems.validation
          : copy.problems.unknown}
    </ProblemNote>
  )
}

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

function valuesOf(pet: Pet): Values {
  const { ageMonths } = pet
  return {
    name: pet.name,
    species: pet.species,
    breed: pet.breed ?? '',
    years: ageMonths === null ? '' : String(Math.floor(ageMonths / 12)),
    months: ageMonths === null || ageMonths % 12 === 0 ? '' : String(ageMonths % 12),
  }
}

/** Only the fields that differ from the saved pet; an emptied breed or age is `null`. */
function changesTo(pet: Pet, basics: Basics): PetPatch {
  const patch: PetPatch = {}
  if (basics.name !== pet.name) patch.name = basics.name
  if (basics.species !== pet.species) patch.species = basics.species
  if (basics.breed !== pet.breed) patch.breed = basics.breed
  if (basics.ageMonths !== pet.ageMonths) patch.ageMonths = basics.ageMonths
  return patch
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

const styles = StyleSheet.create({
  fill: { flex: 1 },
  column: { gap: space[24] },
  back: { alignSelf: 'flex-start', minWidth: 44 },
  header: { gap: space[8] },
  title: { ...textStyle(type.headline), color: colors.deepBlue },
  step: { ...textStyle(type.body), color: colors.slate },
  fields: { gap: space[16] },
  label: { ...textStyle(type.noteTitle), color: colors.deepBlue },
  speciesGroup: { gap: space[8] },
  speciesRow: { flexDirection: 'row', gap: space[16] },
  option: {
    flex: 1,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[8],
    borderRadius: radii.field,
  },
  // The border is 1 pt when idle and 2 pt when chosen; the padding makes up the difference so
  // nothing shifts.
  optionIdle: {
    paddingHorizontal: space[16] - 1,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  optionSelected: {
    paddingHorizontal: space[16] - 2,
    borderWidth: 2,
    borderColor: colors.cobalt,
    backgroundColor: colors.skyTint,
  },
  optionLabel: { ...textStyle(type.cardTitle), color: colors.deepBlue },
  limitBody: textStyle(type.body),
  draftNote: { ...textStyle(type.small), color: colors.slate },
})
