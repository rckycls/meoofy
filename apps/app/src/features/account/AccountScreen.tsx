import { useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { deleteAccount, forgetSession, signOut } from '@pawpin/api'
import { parseAppError } from '@pawpin/core'
import { Button, Card, ScreenShell, colors, space, textStyle, type } from '@pawpin/ui'

import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useProfile } from '../../data/useProfile'
import { ContentColumn } from '../../layout/ContentColumn'
import { OfflineNote } from '../../offline/OfflineNote'
import { useOnline } from '../../offline/useOnline'
import { useSession } from '../../state/SessionProvider'
import { ProblemNote } from '../auth/ProblemNote'
import { TextLink } from '../auth/TextLink'
import { accountCopy as copy } from './copy'

/**
 * Name, email, sign out and delete account. Offline, signing out still works (it forgets the
 * session on this device); changing the name and deleting the account wait for a connection and
 * say so.
 */
export function AccountScreen() {
  const { client, email } = useSession()
  const offline = !useOnline()
  const queryClient = useQueryClient()
  const profile = useProfile()
  const [confirming, setConfirming] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // One account action at a time. A ref, not state: two presses can arrive before a re-render.
  const working = useRef(false)

  async function signOutNow() {
    if (working.current) return
    working.current = true
    setProblem(null)
    setSigningOut(true)
    try {
      // The tab layout leads to sign-in once the session has ended. Offline there is no Auth to
      // tell, and supabase-js would first spend about 25 s retrying a refresh: forget it at once.
      await (offline ? forgetSession(client) : signOut(client))
    } catch {
      setProblem(copy.errors.signOut)
      setSigningOut(false)
      working.current = false
    }
  }

  async function deleteNow() {
    if (working.current) return
    working.current = true
    setProblem(null)
    setDeleting(true)
    try {
      await deleteAccount(client)
    } catch (e) {
      const error = parseAppError(e)
      if (error.code !== 'UNAUTHENTICATED') {
        setProblem(error.code === 'NETWORK' ? copy.errors.offline : copy.errors.delete)
        setConfirming(false)
        setDeleting(false)
        working.current = false
        return
      }
      // A repeated delete after one that went through: the account and its session are gone
      // already (the server answers 401). That is the result the person asked for.
    }
    // The account is gone. `deleteAccount` signs out on a best-effort basis, so make sure no
    // session is left on this device; if that fails there is nothing more the person can do.
    await signOut(client).catch(() => undefined)
    // Nothing of the old account is left to show, on screen or in the saved cache.
    queryClient.clear()
    router.replace('/(auth)/sign-in')
  }

  const displayName = profile.data?.displayName.trim()

  return (
    <>
      {/* The tab bar pads the bottom safe area itself. */}
      <ScreenShell flow="owner" scroll edges={['top', 'left', 'right']}>
        <ContentColumn style={styles.column}>
          <Text accessibilityRole="header" style={styles.title}>
            {copy.title}
          </Text>
          <Card role="plain">
            <Row
              label={copy.name.label}
              action={
                <TextLink
                  label={copy.name.edit}
                  disabled={offline}
                  onPress={() => router.push('/(auth)/your-name?mode=edit')}
                />
              }
            >
              {profile.data !== undefined ? (
                <Text style={styles.value}>
                  {displayName === '' ? copy.name.notSet : displayName}
                </Text>
              ) : profile.isError ? (
                <Text style={styles.value}>{copy.name.unavailable}</Text>
              ) : profile.fetchStatus === 'paused' ? (
                <Text style={styles.value}>{copy.name.offline}</Text>
              ) : (
                <View
                  accessible
                  accessibilityRole="progressbar"
                  accessibilityLabel={copy.name.loading}
                  style={styles.loading}
                >
                  <ActivityIndicator color={colors.cobalt} />
                </View>
              )}
              {offline ? <OfflineNote>{copy.name.editOffline}</OfflineNote> : null}
            </Row>
            <View style={styles.divider} />
            <Row label={copy.email.label}>
              <Text style={styles.value}>{email ?? copy.email.none}</Text>
            </Row>
          </Card>
          {problem === null ? null : <ProblemNote>{problem}</ProblemNote>}
          <Button
            variant="secondary"
            label={copy.signOut}
            loading={signingOut}
            onPress={() => void signOutNow()}
          />
          {offline ? <OfflineNote>{copy.deleteOffline}</OfflineNote> : null}
          <Button
            variant="secondary"
            label={copy.deleteAccount}
            disabled={offline}
            onPress={() => setConfirming(true)}
          />
        </ContentColumn>
      </ScreenShell>

      <ConfirmDialog
        visible={confirming}
        title={copy.deleteDialog.title}
        body={copy.deleteDialog.body}
        confirmLabel={copy.deleteDialog.confirm}
        cancelLabel={copy.deleteDialog.cancel}
        busy={deleting}
        onConfirm={() => void deleteNow()}
        onCancel={() => setConfirming(false)}
      />
    </>
  )
}

/** A label over its value, with an optional action beside them. */
function Row({
  label,
  action,
  children,
}: {
  label: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.label}>{label}</Text>
        {children}
      </View>
      {action}
    </View>
  )
}

const styles = StyleSheet.create({
  column: { gap: space[16] },
  title: { ...textStyle(type.headline), color: colors.deepBlue },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[16], minHeight: 56 },
  rowText: { flex: 1, gap: 4 },
  label: { ...textStyle(type.small), color: colors.slate },
  value: { ...textStyle(type.cardTitle), color: colors.deepBlue },
  loading: { alignSelf: 'flex-start' },
  divider: { height: 1, backgroundColor: colors.line },
})
