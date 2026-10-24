import { useState } from 'react'
import { Redirect, router, useLocalSearchParams } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { AppError, codePointLength, displayNameSchema, parseAppError } from '@pawpin/core'
import { Button, Field } from '@pawpin/ui'

import { useProfile } from '../../data/useProfile'
import { reportHandledError } from '../../observability/sentry'
import { confirmSession } from '../../state/sessionCheck'
import { useSession } from '../../state/SessionProvider'
import { stepBack } from '../onboarding/progress'
import { AuthFrame } from './AuthFrame'
import { authCopy } from './copy'
import { problemText } from './problem'
import { ProblemNote } from './ProblemNote'
import { saveDisplayName } from './profileName'
import { TextLink } from './TextLink'

const copy = authCopy.yourName

/**
 * "What should we call you?" for a person with no name yet; saving it opens O03.
 *
 * Opened from Account with `?mode=edit`, it changes the name instead: the field starts with the
 * current name, and saving (or Cancel) goes back to Account.
 */
export function YourNameScreen() {
  const { client, signedIn } = useSession()
  const queryClient = useQueryClient()
  const editing = useLocalSearchParams<{ mode?: string }>().mode === 'edit'
  const current = useProfile().data?.displayName
  // `null` until the person types, so a current name that arrives late can still fill the field.
  const [typed, setTyped] = useState<string | null>(null)
  const name = typed ?? (editing ? (current ?? '') : '')
  const [nameError, setNameError] = useState<string | null>(null)
  const [problem, setProblem] = useState<AppError | null>(null)
  const [saving, setSaving] = useState(false)

  // The name belongs to a signed-in person. If the session is gone (it ended, or this was opened
  // directly), signing in comes first.
  if (!signedIn) return <Redirect href="/(auth)/sign-in" />

  async function save() {
    if (saving) return
    const parsed = displayNameSchema.safeParse(name)
    if (!parsed.success) {
      setNameError(codePointLength(name.trim()) === 0 ? copy.required : copy.tooLong)
      return
    }
    setNameError(null)
    setProblem(null)
    setSaving(true)
    try {
      await saveDisplayName(client, queryClient, parsed.data)
      if (editing) stepBack('/(tabs)/account')
      else router.replace('/(onboarding)/all-set')
    } catch (e) {
      const error = parseAppError(e)
      // An UNAUTHENTICATED answer can mean the session is gone or only that a refresh failed for
      // a moment. Auth decides: a refused session signs out, and this screen then leads to sign-in.
      if (error.code === 'UNAUTHENTICATED') void confirmSession(client, e)
      reportHandledError(e, 'updateDisplayName')
      if (error.code === 'VALIDATION') setNameError(copy.required)
      else setProblem(error)
      setSaving(false)
    }
  }

  const text = editing ? copy.edit : copy
  return (
    <AuthFrame stickers={['heart-paw']} title={text.title} body={text.body}>
      <Field
        testID="name-input"
        label={copy.label}
        value={name}
        onChangeText={(value) => {
          setTyped(value)
          setNameError(null)
        }}
        error={nameError ?? undefined}
        autoCapitalize="words"
        autoComplete="given-name"
        textContentType="givenName"
        returnKeyType="done"
        onSubmitEditing={() => void save()}
      />
      {problem === null ? null : <ProblemNote>{problemText(problem)}</ProblemNote>}
      <Button variant="primary" label={text.action} loading={saving} onPress={() => void save()} />
      {editing ? (
        <TextLink label={copy.edit.cancel} onPress={() => stepBack('/(tabs)/account')} />
      ) : null}
    </AuthFrame>
  )
}
