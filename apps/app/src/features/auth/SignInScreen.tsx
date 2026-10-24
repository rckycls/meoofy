import { useEffect, useState } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import * as AppleAuthentication from 'expo-apple-authentication'
import { Redirect, router, useLocalSearchParams } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { sendEmailCode, signInWithAppleIdToken, signInWithAppleWeb } from '@pawpin/api'
import { AppError, parseAppError } from '@pawpin/core'
import { Button, Field, colors, radii, space, textStyle, type } from '@pawpin/ui'

import { reportHandledError } from '../../observability/sentry'
import { useSession } from '../../state/SessionProvider'
import { createNonce } from './appleNonce'
import { useAuthFlow } from './AuthFlow'
import { AuthFrame } from './AuthFrame'
import { AuthProblem } from './AuthProblem'
import { authCopy } from './copy'
import { nameFromApple } from './profileName'
import { useContinueWhenSignedIn } from './useContinueWhenSignedIn'
import { isValidEmail } from './validation'

const copy = authCopy.signIn

type Busy = 'email' | 'apple' | null

/** Apple's sheet was closed without choosing. That is a decision, not a failure. */
function isCancelled(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ERR_REQUEST_CANCELED'
  )
}

/**
 * Whether to offer Sign in with Apple: always on the web (a redirect through Supabase), and on
 * iOS when the system says it can. Other platforms are not targets.
 */
function useAppleAvailable(): boolean {
  const native = Platform.OS === 'ios'
  const [available, setAvailable] = useState(native || Platform.OS === 'web')

  useEffect(() => {
    if (!native) return
    let active = true
    AppleAuthentication.isAvailableAsync().then(
      (ok) => {
        if (active) setAvailable(ok)
      },
      () => {
        if (active) setAvailable(false)
      },
    )
    return () => {
      active = false
    }
  }, [native])

  return available
}

/**
 * O01 owner welcome: Sign in with Apple, or an emailed 6-digit code. Opened with
 * `?deletion=unconfirmed` (Account, after a deletion that ended in UNAUTHENTICATED; Ruling 25), it
 * also says how to tell whether the account was deleted.
 */
export function SignInScreen() {
  const { client, signedIn } = useSession()
  const { deletion } = useLocalSearchParams<{ deletion?: string }>()
  const queryClient = useQueryClient()
  const { setEmail: rememberEmail } = useAuthFlow()
  const continueWhenSignedIn = useContinueWhenSignedIn()
  // Opened while already signed in (the browser's back button, a bookmark): nothing to ask. Only
  // the state at the start counts; signing in from this screen is finished by the flows below.
  const [alreadySignedIn] = useState(signedIn)
  const appleAvailable = useAppleAvailable()

  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [problem, setProblem] = useState<AppError | null>(null)
  const [busy, setBusy] = useState<Busy>(null)

  if (alreadySignedIn) return <Redirect href="/" />

  async function submitEmail() {
    if (busy !== null) return
    const address = email.trim()
    if (!isValidEmail(address)) {
      setEmailError(copy.emailInvalid)
      return
    }
    setEmailError(null)
    setProblem(null)
    setBusy('email')
    try {
      await sendEmailCode(client, address)
      rememberEmail(address)
      router.push('/(auth)/email-code')
    } catch (e) {
      const error = parseAppError(e)
      reportHandledError(e, 'sendEmailCode')
      if (error.code === 'VALIDATION') setEmailError(copy.emailInvalid)
      else setProblem(error)
    } finally {
      setBusy(null)
    }
  }

  async function continueWithApple() {
    if (busy !== null) return
    setProblem(null)
    setBusy('apple')
    try {
      if (Platform.OS === 'web') {
        // The browser leaves for Apple and comes back signed in; the entry gate takes over there.
        await signInWithAppleWeb(client)
        setBusy(null)
        return
      }
      const { raw, hashed } = await createNonce()
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashed,
      })
      if (credential.identityToken === null) {
        throw new AppError('UNKNOWN', 'Apple returned no identity token')
      }
      await signInWithAppleIdToken(client, credential.identityToken, raw)
      const givenName = credential.fullName?.givenName
      // A new person Apple has just named goes straight to the last onboarding screen; anyone
      // else is sent on by the entry gate (the name step if they have none, otherwise Home or Find).
      continueWhenSignedIn(async () =>
        (await nameFromApple(client, queryClient, givenName)) ? '/(onboarding)/all-set' : '/',
      )
    } catch (e) {
      if (!isCancelled(e)) {
        reportHandledError(e, 'signInWithApple')
        setProblem(parseAppError(e))
      }
      setBusy(null)
    }
  }

  return (
    <AuthFrame stickers={['dog', 'paw-pin', 'cat']} title={copy.title} body={copy.body}>
      {deletion === 'unconfirmed' ? (
        <Text style={styles.note}>{copy.deletionUnconfirmed}</Text>
      ) : null}
      {appleAvailable ? (
        <>
          {Platform.OS === 'web' ? (
            <Button
              variant="secondary"
              label={copy.apple}
              loading={busy === 'apple'}
              disabled={busy === 'email'}
              onPress={() => void continueWithApple()}
            />
          ) : (
            // The system's own button: it is what Apple's guidelines ask for on iOS, and it
            // carries its own accessibility label.
            <View style={busy === null ? null : styles.dimmed}>
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={radii.button}
                style={styles.appleButton}
                onPress={() => void continueWithApple()}
              />
            </View>
          )}
          <View aria-hidden style={styles.divider}>
            <View style={styles.rule} />
            <Text style={styles.dividerLabel}>{copy.divider}</Text>
            <View style={styles.rule} />
          </View>
        </>
      ) : null}
      <Field
        testID="email-input"
        label={copy.emailLabel}
        placeholder={copy.emailPlaceholder}
        value={email}
        onChangeText={(text) => {
          setEmail(text)
          setEmailError(null)
        }}
        error={emailError ?? undefined}
        keyboardType="email-address"
        inputMode="email"
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        textContentType="emailAddress"
        returnKeyType="go"
        onSubmitEditing={() => void submitEmail()}
      />
      {problem === null ? null : <AuthProblem error={problem} />}
      <Button
        variant="primary"
        label={copy.emailAction}
        loading={busy === 'email'}
        disabled={busy === 'apple'}
        onPress={() => void submitEmail()}
      />
    </AuthFrame>
  )
}

const styles = StyleSheet.create({
  appleButton: { width: '100%', height: 48 },
  dimmed: { opacity: 0.5 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: space[16] },
  rule: { flex: 1, height: 1, backgroundColor: colors.line },
  dividerLabel: { ...textStyle(type.small), color: colors.slate },
  note: { ...textStyle(type.body), color: colors.deepBlue },
})
