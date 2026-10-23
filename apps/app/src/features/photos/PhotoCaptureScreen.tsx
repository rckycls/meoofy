import { useRef, useState } from 'react'
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native'
import { Redirect, useLocalSearchParams } from 'expo-router'
import type { Pet } from '@pawpin/api'
import { parseAppError, type PhotoView } from '@pawpin/core'
import { Button, Card, ScreenShell, colors, space, textStyle, type } from '@pawpin/ui'

import { usePhotoUpload, type PhotoState } from '../../data/usePhotoUpload'
import { usePet } from '../../data/usePet'
import { readyPhotos, usePhotos } from '../../data/usePhotos'
import { env } from '../../env'
import { ContentColumn } from '../../layout/ContentColumn'
import { testPhotoUri } from '../../photo/testPhotos'
import { GUIDED_VIEWS, type GuidedView } from '../../photo/views'
import { useSession } from '../../state/SessionProvider'
import { ProblemNote } from '../auth/ProblemNote'
import { TextLink } from '../auth/TextLink'
import { stepBack } from '../onboarding/progress'
import { PetUnavailable } from '../pets/PetProfileScreen'
import { CameraSheet, pickFromLibrary } from './CameraSheet'
import { photosCopy as copy } from './copy'
import { ViewTile } from './ViewTile'

/** The first view other than `saved` that has no ready photo, or `saved` when all have one. */
function nextView(saved: GuidedView, states: Record<PhotoView, PhotoState> | null): GuidedView {
  return GUIDED_VIEWS.find((view) => view !== saved && states?.[view] !== 'ready') ?? saved
}

/** O04: guided capture of the front, side and markings photos of one pet. */
export function PhotoCaptureScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { signedIn } = useSession()
  const pet = usePet(id)

  if (!signedIn) return <Redirect href="/(auth)/sign-in" />
  if (pet.data == null) return <PetUnavailable pet={pet} />
  return <PhotoCapture pet={pet.data} />
}

function PhotoCapture({ pet }: { pet: Pet }) {
  const photos = usePhotos(pet.id)
  const [selected, setSelected] = useState<GuidedView>('front')
  const [cameraFor, setCameraFor] = useState<GuidedView | null>(null)
  const [sourceFailed, setSourceFailed] = useState(false)
  // The web has no camera view: a browser's file chooser offers the camera itself on a phone.
  const canUseCamera = Platform.OS !== 'web'

  // When the selected view's photo is saved, move on to the next view that has none. (A person who
  // has gone to another tile meanwhile stays where they are.) `onSaved` runs after the render that
  // showed the upload, so it reads the states of that render from a ref.
  const states = useRef<Record<PhotoView, PhotoState> | null>(null)
  const { upload, retry, state, problem } = usePhotoUpload(pet.id, {
    onSaved: (saved) =>
      setSelected((current) => (current === saved ? nextView(saved, states.current) : current)),
  })
  states.current = state
  const ready = readyPhotos(photos.data)

  async function choose(view: GuidedView) {
    setSourceFailed(false)
    let uri: string | null
    try {
      uri = await pickFromLibrary()
    } catch {
      setSourceFailed(true)
      return
    }
    if (uri !== null) await upload(view, uri)
  }

  async function addTestPhoto(view: GuidedView) {
    setSourceFailed(false)
    let uri: string
    try {
      uri = await testPhotoUri(view)
    } catch {
      setSourceFailed(true)
      return
    }
    await upload(view, uri)
  }

  function photoTaken(view: GuidedView, uri: string) {
    setCameraFor(null)
    void upload(view, uri)
  }

  const allReady = GUIDED_VIEWS.every((view) => state[view] === 'ready')
  const loading = photos.isPending && photos.fetchStatus === 'fetching'

  return (
    <>
      <ScreenShell flow="owner" scroll>
        <ContentColumn style={styles.column}>
          <View style={styles.back}>
            <TextLink label={copy.back} onPress={() => stepBack(`/pets/${pet.id}`)} />
          </View>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>
              {copy.title}
            </Text>
            <Text style={styles.intro}>{copy.intro(pet.name)}</Text>
          </View>
          <Card role="tip" title={copy.tips.title}>
            {copy.tips.body}
          </Card>

          {loading ? (
            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={copy.loading}
              style={styles.loading}
            >
              <ActivityIndicator color={colors.cobalt} />
            </View>
          ) : (
            <>
              {photos.isError ? (
                <ProblemNote>
                  {parseAppError(photos.error).code === 'NETWORK'
                    ? copy.problems.NETWORK
                    : copy.loadFailed}
                </ProblemNote>
              ) : null}
              {photos.isError ? (
                <Button
                  variant="secondary"
                  label={copy.actions.retry}
                  onPress={() => void photos.refetch()}
                />
              ) : null}
              <View accessibilityRole="radiogroup" aria-label={copy.group} style={styles.tiles}>
                {GUIDED_VIEWS.map((view) => (
                  <ViewTile
                    key={view}
                    view={view}
                    species={pet.species}
                    state={state[view]}
                    photo={ready[view]}
                    problem={problem[view]}
                    selected={view === selected}
                    canUseCamera={canUseCamera}
                    onSelect={() => setSelected(view)}
                    onTake={() => setCameraFor(view)}
                    onChoose={() => void choose(view)}
                    onRetry={() => void retry(view)}
                    onTestPhoto={env.e2e ? () => void addTestPhoto(view) : undefined}
                  />
                ))}
              </View>
              {sourceFailed ? <ProblemNote>{copy.sourceFailed}</ProblemNote> : null}
            </>
          )}

          <Button
            variant={allReady ? 'primary' : 'secondary'}
            label={allReady ? copy.actions.done : copy.actions.later}
            onPress={() => stepBack(`/pets/${pet.id}`)}
          />
        </ContentColumn>
      </ScreenShell>

      {cameraFor === null ? null : (
        <CameraSheet
          view={cameraFor}
          onPhoto={(uri) => photoTaken(cameraFor, uri)}
          onClose={() => setCameraFor(null)}
        />
      )}
    </>
  )
}

const styles = StyleSheet.create({
  column: { gap: space[16] },
  back: { alignSelf: 'flex-start', minWidth: 44 },
  header: { gap: space[8] },
  title: { ...textStyle(type.headline), color: colors.deepBlue },
  intro: { ...textStyle(type.body), color: colors.slate },
  loading: { paddingVertical: space[32] },
  tiles: { gap: space[16] },
})
