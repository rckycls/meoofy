import { useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { deleteAccount, signOut } from '@pawpin/api'
import { parseAppError } from '@pawpin/core'
import { Button, Card, ScreenShell, cardRoles, colors, space, textStyle, type } from '@pawpin/ui'

import { useProfile } from '../../data/useProfile'
import { ContentColumn } from '../../layout/ContentColumn'
import { useSession } from '../../state/SessionProvider'
import { ProblemNote } from '../auth/ProblemNote'
import { TextLink } from '../auth/TextLink'
import { accountCopy as copy } from './copy'

/** Name, email, sign out and delete account. */
export function AccountScreen() {
  const { client, email } = useSession()
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
      // The tab layout leads to sign-in once the session has ended.
      await signOut(client)
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
      // Also ends the session on this device.
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
      await signOut(client).catch(() => undefined)
    }
    // Nothing of the old account is left to show, on screen or in the saved cache.
    queryClient.clear()
    router.replace('/(auth)/sign-in')
  }

  const closeDialog = () => {
    if (!deleting) setConfirming(false)
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
          <Button
            variant="secondary"
            label={copy.deleteAccount}
            onPress={() => setConfirming(true)}
          />
        </ContentColumn>
      </ScreenShell>

      <Modal visible={confirming} transparent animationType="none" onRequestClose={closeDialog}>
        <View style={styles.fill}>
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop]} />
          {/* Larger text scrolls the dialog instead of clipping it. */}
          <ScrollView contentContainerStyle={styles.overlay}>
            <View
              role="alertdialog"
              aria-modal
              aria-label={copy.deleteDialog.title}
              accessibilityViewIsModal
              style={styles.dialog}
            >
              <Card role="warning" title={copy.deleteDialog.title}>
                <Text style={[styles.dialogBody, { color: cardRoles.warning.body }]}>
                  {copy.deleteDialog.body}
                </Text>
                <View style={styles.actions}>
                  <Button
                    variant="urgent"
                    label={copy.deleteDialog.confirm}
                    loading={deleting}
                    onPress={() => void deleteNow()}
                  />
                  <Button
                    variant="secondary"
                    label={copy.deleteDialog.cancel}
                    disabled={deleting}
                    onPress={closeDialog}
                  />
                </View>
              </Card>
            </View>
          </ScrollView>
        </View>
      </Modal>
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
  fill: { flex: 1 },
  overlay: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: space[24] },
  // The page behind, dimmed with the deep blue; the dialog itself stays fully opaque.
  backdrop: { backgroundColor: colors.deepBlue, opacity: 0.5 },
  dialog: { width: '100%', maxWidth: 420 },
  dialogBody: textStyle(type.body),
  actions: { gap: space[8], marginTop: space[8] },
})
