import { useEffect, useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { parseAppError, petLimit, speciesSchema, type AppError, type Species } from '@pawpin/core'
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

import { ContentColumn } from '../../layout/ContentColumn'
import { OfflineBanner } from '../../offline/OfflineBanner'
import { OfflineNote } from '../../offline/OfflineNote'
import { useOnline } from '../../offline/useOnline'
import { confirmSession } from '../../state/sessionCheck'
import { useSession } from '../../state/SessionProvider'
import { ProblemNote } from '../auth/ProblemNote'
import { TextLink } from '../auth/TextLink'
import { AgeInput } from './AgeInput'
import { petsCopy as copy } from './copy'
import {
  EMPTY,
  clearedBy,
  readBasics,
  type Basics,
  type FieldErrors,
  type Values,
} from './petFormValues'

type PetFormProps = {
  title: string
  /** "Step 1 of 3 · Basics" while adding. */
  step?: string
  actionLabel: string
  /** What waits for a connection while offline, said next to the action that is off. */
  offlineNote: string
  /** Where the fields start. A field the person hasn't touched follows it if it changes later. */
  initial: Partial<Values>
  showPrivacy: boolean
  onBack: () => void
  /**
   * Saves valid details. Resolves with how to leave the form, which is skipped if the person has
   * already left it (Back while the request was in flight). Rejects with whatever went wrong.
   */
  onSubmit: (basics: Basics) => Promise<() => void>
  /** Keeps the form as it is on the device (adding only). Offline it is the form's main action. */
  onSaveDraft?: (values: Values) => Promise<void>
}

/**
 * The pet basics form of O03, for adding a pet and for editing one. Offline nothing can be sent:
 * the action is off and `offlineNote` says why, and an add form leads with Save as draft.
 */
export function PetForm({
  title,
  step,
  actionLabel,
  offlineNote,
  initial,
  showPrivacy,
  onBack,
  onSubmit,
  onSaveDraft,
}: PetFormProps) {
  const { client } = useSession()
  const offline = !useOnline()
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

  const draftFirst = offline && onSaveDraft !== undefined
  const action = (
    <Button
      variant={draftFirst ? 'secondary' : 'primary'}
      label={actionLabel}
      loading={saving}
      disabled={offline}
      onPress={() => void submit()}
    />
  )
  const draftAction =
    onSaveDraft === undefined ? null : (
      <Button
        variant={draftFirst ? 'primary' : 'secondary'}
        label={copy.add.saveDraft}
        onPress={() => void saveAsDraft()}
      />
    )

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
          <OfflineBanner />
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
              testID="pet-name-input"
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
              testID="pet-breed-input"
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
              <View style={styles.cornerSticker}>
                <Sticker name="privacy-shield" size={40} rotate={6} />
              </View>
              {/* A string alone is the card's body text; beside the sticker it needs its own. */}
              <Text style={[styles.privacyBody, { color: cardRoles.privacy.body }]}>
                {copy.add.privacy.body}
              </Text>
            </Card>
          ) : null}
          {problem === null ? null : <ProblemView error={problem} />}
          {offline ? <OfflineNote>{offlineNote}</OfflineNote> : null}
          {draftFirst ? draftAction : action}
          {draftFirst ? action : draftAction}
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
              // react-native-web ignores `accessibilityState`; this is what puts the state in the page.
              aria-checked={selected}
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
  cornerSticker: { position: 'absolute', top: space[8], right: space[8] },
  privacyBody: textStyle(type.body),
})
