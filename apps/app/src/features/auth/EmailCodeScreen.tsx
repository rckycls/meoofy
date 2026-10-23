import { useState } from 'react'
import { StyleSheet, Text } from 'react-native'
import { Redirect } from 'expo-router'
import { sendEmailCode, verifyEmailCode } from '@pawpin/api'
import { parseAppError, type AppError } from '@pawpin/core'
import { Button, colors, space, textStyle, type } from '@pawpin/ui'

import { useSession } from '../../state/SessionProvider'
import { stepBack } from '../onboarding/progress'
import { useAuthFlow } from './AuthFlow'
import { AuthFrame } from './AuthFrame'
import { CodeInput } from './CodeInput'
import { authCopy } from './copy'
import { problemText } from './problem'
import { ProblemNote } from './ProblemNote'
import { TextLink } from './TextLink'
import { useContinueWhenSignedIn } from './useContinueWhenSignedIn'
import { useCountdown } from './useCountdown'
import { CODE_LENGTH, codeDigits } from './validation'

const copy = authCopy.emailCode

/** Seconds before "Resend code" can be used again. */
const RESEND_AFTER = 30

/** The code screen. Without an email (a reload) there is nothing to enter a code for. */
export function EmailCodeScreen() {
  const { email } = useAuthFlow()
  if (email === null) return <Redirect href="/(auth)/sign-in" />
  return <CodeEntry email={email} />
}

/** F08: enter the 6-digit code that was emailed; S05 when it did not work. */
function CodeEntry({ email }: { email: string }) {
  const { client } = useSession()
  const continueWhenSignedIn = useContinueWhenSignedIn()
  const countdown = useCountdown(RESEND_AFTER)

  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [sending, setSending] = useState(false)
  // S05: Auth refused the code. It reports a wrong and an expired code alike.
  const [refused, setRefused] = useState(false)
  const [problem, setProblem] = useState<AppError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function verify(digits: string) {
    if (verifying || sending) return
    setVerifying(true)
    setRefused(false)
    setProblem(null)
    setNotice(null)
    try {
      await verifyEmailCode(client, email, digits)
      // The entry gate sends a new person to the name step and a returning one to Home or Find.
      continueWhenSignedIn(async () => '/')
    } catch (e) {
      const error = parseAppError(e)
      if (error.code === 'UNAUTHENTICATED') {
        setRefused(true)
        setCode('')
      } else {
        setProblem(error)
      }
      setVerifying(false)
    }
  }

  async function sendNewCode() {
    if (verifying || sending) return
    setSending(true)
    setProblem(null)
    try {
      await sendEmailCode(client, email)
      setRefused(false)
      setCode('')
      setNotice(copy.sentAgain(email))
      countdown.restart()
    } catch (e) {
      setProblem(parseAppError(e))
    } finally {
      setSending(false)
    }
  }

  function change(text: string) {
    const digits = codeDigits(text)
    setCode(digits)
    if (digits.length === CODE_LENGTH) void verify(digits)
  }

  const waiting = countdown.remaining > 0

  return (
    <AuthFrame stickers={['love-letter']} title={copy.title} body={copy.body(email)}>
      <CodeInput
        label={copy.codeLabel}
        value={code}
        onChangeText={change}
        invalid={refused}
        editable={!verifying}
      />
      {refused ? <ProblemNote title={copy.expired.title}>{copy.expired.body}</ProblemNote> : null}
      {problem === null ? null : <ProblemNote>{problemText(problem)}</ProblemNote>}
      {notice === null ? null : (
        <Text accessibilityLiveRegion="polite" style={styles.notice}>
          {notice}
        </Text>
      )}
      <Button
        variant={refused ? 'secondary' : 'primary'}
        label={copy.verify}
        loading={verifying}
        disabled={code.length < CODE_LENGTH || sending}
        onPress={() => void verify(code)}
      />
      {refused ? (
        <Button
          variant="primary"
          label={copy.expired.action}
          loading={sending}
          disabled={verifying}
          onPress={() => void sendNewCode()}
        />
      ) : (
        <>
          <Button
            variant="secondary"
            label={copy.resend}
            loading={sending}
            disabled={waiting || verifying}
            onPress={() => void sendNewCode()}
          />
          {waiting ? (
            <Text style={styles.countdown}>{copy.resendIn(countdown.remaining)}</Text>
          ) : null}
        </>
      )}
      <TextLink label={copy.differentEmail} onPress={() => stepBack('/(auth)/sign-in')} />
    </AuthFrame>
  )
}

const styles = StyleSheet.create({
  notice: { ...textStyle(type.small), color: colors.slate },
  countdown: {
    ...textStyle(type.small),
    color: colors.slate,
    textAlign: 'center',
    marginTop: -space[8],
  },
})
