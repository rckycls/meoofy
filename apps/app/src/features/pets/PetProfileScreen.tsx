import { useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { Redirect, router, useLocalSearchParams } from 'expo-router'
import type { Pet } from '@meoofy/api'
import { formatAge, parseAppError } from '@meoofy/core'
import {
  Button,
  Card,
  Chip,
  PetPortrait,
  ScreenShell,
  cardRoles,
  colors,
  space,
  textStyle,
  type,
} from '@meoofy/ui'

import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useDeletePet } from '../../data/useDeletePet'
import { usePet } from '../../data/usePet'
import { env } from '../../env'
import { ContentColumn } from '../../layout/ContentColumn'
import { OfflineBanner } from '../../offline/OfflineBanner'
import { OfflineNote } from '../../offline/OfflineNote'
import { useOnline } from '../../offline/useOnline'
import { confirmSession } from '../../state/sessionCheck'
import { useSession } from '../../state/SessionProvider'
import { ProblemNote } from '../auth/ProblemNote'
import { TextLink } from '../auth/TextLink'
import { stepBack } from '../onboarding/progress'
import { petsCopy } from './copy'

const copy = petsCopy.profile
const PORTRAIT = 96

/** The breed, then the age; the species stands in when neither is known. */
function detail(pet: Pet): string {
  const parts = [pet.breed, formatAge(pet.ageMonths)].filter((part) => part !== null && part !== '')
  return parts.length === 0 ? petsCopy.species[pet.species] : parts.join(' · ')
}

/** A pet screen's scrolling page: the owner-flow tint, a column, the offline banner and a way Back. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <ScreenShell flow="owner" scroll>
      <ContentColumn style={styles.column}>
        <OfflineBanner />
        <View style={styles.back}>
          <TextLink label={petsCopy.back} onPress={() => stepBack('/(tabs)/home')} />
        </View>
        {children}
      </ContentColumn>
    </ScreenShell>
  )
}

/**
 * What stands in for a pet that isn't there to show: a progress indicator while it loads, a note
 * when the load failed (with a retry), or the not-found state with a way Home.
 */
export function PetUnavailable({ pet }: { pet: ReturnType<typeof usePet> }) {
  // A pet that isn't theirs reads as `null`; an id that isn't a pet id is refused as VALIDATION.
  const code = pet.isError ? parseAppError(pet.error).code : null
  const missing = pet.data === null || code === 'VALIDATION' || code === 'NOT_OWNER'

  if (missing) {
    return (
      <Frame>
        <Card role="plain" title={copy.notFound.title}>
          {copy.notFound.body}
        </Card>
        <Button
          variant="primary"
          label={copy.notFound.home}
          onPress={() => router.replace('/(tabs)/home')}
        />
      </Frame>
    )
  }
  if (pet.isError) {
    return (
      <Frame>
        <ProblemNote>
          {code === 'NETWORK' ? petsCopy.problems.offline : copy.errors.loadFailed}
        </ProblemNote>
        <Button variant="secondary" label={copy.errors.retry} onPress={() => void pet.refetch()} />
      </Frame>
    )
  }
  // The device is offline and the pet isn't cached: the read waits for the network.
  if (pet.fetchStatus === 'paused') {
    return (
      <Frame>
        <ProblemNote>{petsCopy.problems.offline}</ProblemNote>
      </Frame>
    )
  }
  return (
    <Frame>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={copy.loading}
        style={styles.loading}
      >
        <ActivityIndicator color={colors.cobalt} />
      </View>
    </Frame>
  )
}

/** O05: the private profile with Discovery Off explained, Edit, and Delete (read-only offline). */
export function PetProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { client, signedIn } = useSession()
  const offline = !useOnline()
  const pet = usePet(id)
  const remove = useDeletePet()
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // One deletion at a time. A ref, not state: two presses can arrive before a re-render.
  const working = useRef(false)

  if (!signedIn) return <Redirect href="/(auth)/sign-in" />
  if (pet.data == null) return <PetUnavailable pet={pet} />

  const current = pet.data

  async function deleteNow() {
    if (working.current) return
    working.current = true
    setProblem(null)
    setDeleting(true)
    try {
      // A pet that is already gone counts as deleted (the API resolves for it).
      await remove.mutateAsync(current.id)
    } catch (e) {
      const error = parseAppError(e)
      // The session may be gone, or a refresh may only have failed for a moment: Auth decides,
      // and a refused session signs out, which leads this screen to sign-in.
      if (error.code === 'UNAUTHENTICATED') void confirmSession(client, e)
      setProblem(
        error.code === 'NETWORK' ? petsCopy.problems.offline : copy.errors.delete(current.name),
      )
      setConfirming(false)
      setDeleting(false)
      working.current = false
      return
    }
    // Back to the tabs this profile was pushed over, on Home; when there are none below (the
    // profile was opened directly), the profile is replaced by them.
    router.dismissTo('/(tabs)/home')
  }

  return (
    <>
      <Frame>
        <View style={styles.hero}>
          {/* Decoration: the species is in the text below. */}
          <View
            aria-hidden
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <PetPortrait
              species={current.species}
              flow="owner"
              width={PORTRAIT}
              height={PORTRAIT}
            />
          </View>
          <View style={styles.identity}>
            <Text accessibilityRole="header" style={styles.name}>
              {current.name}
            </Text>
            <Text style={styles.detail}>{detail(current)}</Text>
            <Chip kind="private" />
          </View>
        </View>
        <Card role="privacy" title={copy.discovery.title}>
          <Text style={[styles.body, { color: cardRoles.privacy.body }]}>
            {copy.discovery.notSearchable(current.name)}
          </Text>
          <Text style={[styles.small, { color: cardRoles.privacy.body }]}>
            {copy.discovery.detail}
          </Text>
        </Card>
        {problem === null ? null : <ProblemNote>{problem}</ProblemNote>}
        {offline ? <OfflineNote>{copy.offline}</OfflineNote> : null}
        <Button
          variant="primary"
          label={copy.edit}
          disabled={offline}
          onPress={() => router.push(`/pets/${current.id}/edit`)}
        />
        <Button
          variant="secondary"
          label={copy.photos}
          onPress={() => router.push(`/pets/${current.id}/photos`)}
        />
        {env.flags.reportMissing ? (
          // Ships with the recovery sub-project; its report screen will live at this route.
          <Button
            variant="secondary"
            label={copy.reportMissing(current.name)}
            onPress={() => router.push(`/pets/${current.id}/report-missing`)}
          />
        ) : null}
        <Button
          variant="secondary"
          label={copy.delete}
          disabled={offline}
          onPress={() => setConfirming(true)}
        />
      </Frame>

      <ConfirmDialog
        visible={confirming}
        title={copy.deleteDialog.title(current.name)}
        body={copy.deleteDialog.body(current.name)}
        confirmLabel={copy.deleteDialog.confirm(current.name)}
        cancelLabel={copy.deleteDialog.cancel}
        busy={deleting}
        onConfirm={() => void deleteNow()}
        onCancel={() => setConfirming(false)}
      />
    </>
  )
}

const styles = StyleSheet.create({
  column: { gap: space[16] },
  back: { alignSelf: 'flex-start', minWidth: 44 },
  loading: { paddingVertical: space[32] },
  hero: { flexDirection: 'row', alignItems: 'center', gap: space[16] },
  identity: { flex: 1, gap: 4 },
  name: { ...textStyle(type.headline), color: colors.deepBlue },
  detail: { ...textStyle(type.body), color: colors.slate },
  body: textStyle(type.body),
  small: textStyle(type.small),
})
