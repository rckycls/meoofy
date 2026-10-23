import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import type { PetPhoto } from '@pawpin/api'
import type { Species } from '@pawpin/core'
import { Button, PetPortrait, colors, radii, space, textStyle, type } from '@pawpin/ui'

import { canRetry, type PhotoProblem, type PhotoState } from '../../data/usePhotoUpload'
import type { GuidedView } from '../../photo/views'
import { ProblemNote } from '../auth/ProblemNote'
import { photosCopy as copy } from './copy'

const THUMBNAIL = 88

export type ViewTileProps = {
  view: GuidedView
  species: Species
  state: PhotoState
  /** The view's ready photo, if it has one; its signed URL is the thumbnail. */
  photo: PetPhoto | undefined
  /** Why the last photo for this view was not added. */
  problem: PhotoProblem | undefined
  selected: boolean
  /** False where there is no camera view (the web): the person chooses a photo instead. */
  canUseCamera: boolean
  onSelect: () => void
  onTake: () => void
  onChoose: () => void
  onRetry: () => void
  /** The server said RATE_LIMITED a moment ago: "Try again" waits, and the tile says so. */
  retryWaiting: boolean
  /** Set only in end-to-end builds, which show "Use test photo". */
  onTestPhoto: (() => void) | undefined
}

function Thumbnail({ view, species, photo }: Pick<ViewTileProps, 'view' | 'species' | 'photo'>) {
  if (photo?.signedUrl) {
    return (
      <Image
        testID={`thumb-${view}`}
        source={{ uri: photo.signedUrl }}
        accessibilityIgnoresInvertColors
        resizeMode="cover"
        style={styles.thumbnail}
      />
    )
  }
  // Decoration: the tile's name and state say everything the portrait could.
  return (
    <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <PetPortrait species={species} flow="owner" width={THUMBNAIL} height={THUMBNAIL} />
    </View>
  )
}

/**
 * One of the three views (front, side, markings). The header is a radio: it says which view it is
 * and where its photo is, and selects the view. The selected tile also shows what to photograph
 * and what can be done: take or choose a photo, send the same one again, or (in end-to-end builds)
 * use the bundled test photo.
 */
export function ViewTile({
  view,
  species,
  state,
  photo,
  problem,
  selected,
  canUseCamera,
  onSelect,
  onTake,
  onChoose,
  onRetry,
  retryWaiting,
  onTestPhoto,
}: ViewTileProps) {
  const { title, hint } = copy.views[view]
  const busy = state === 'checking' || state === 'uploading'
  // A failed new photo leaves the earlier one in place, and the words say so.
  const keptPrevious = state === 'ready' && problem !== undefined
  const status = keptPrevious ? copy.status.keptPrevious : copy.status[state]
  const retrying = canRetry(problem)

  return (
    <View
      testID={`tile-${view}`}
      style={[styles.tile, selected ? styles.tileSelected : styles.tileIdle]}
    >
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel={copy.tileLabel(view, state, keptPrevious)}
        accessibilityState={{ selected, checked: selected }}
        onPress={onSelect}
        style={styles.header}
      >
        <Thumbnail view={view} species={species} photo={photo} />
        <View style={styles.text}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.status}>{status}</Text>
        </View>
      </Pressable>

      {selected ? (
        <View style={styles.body}>
          <Text style={styles.hint}>{hint}</Text>
          {problem === undefined ? null : <ProblemNote>{copy.problems[problem]}</ProblemNote>}
          {retrying && retryWaiting ? <Text style={styles.hint}>{copy.retryWait}</Text> : null}
          {retrying ? (
            <Button
              variant="primary"
              label={copy.actions.retry}
              disabled={busy || retryWaiting}
              onPress={onRetry}
            />
          ) : null}
          {canUseCamera ? (
            <>
              <Button
                variant={retrying ? 'secondary' : 'primary'}
                label={photo === undefined ? copy.actions.take : copy.actions.retake}
                disabled={busy}
                onPress={onTake}
              />
              <Button
                variant="secondary"
                label={copy.actions.library}
                disabled={busy}
                onPress={onChoose}
              />
            </>
          ) : (
            <Button
              variant={retrying ? 'secondary' : 'primary'}
              label={copy.actions.upload}
              disabled={busy}
              onPress={onChoose}
            />
          )}
          {onTestPhoto === undefined ? null : (
            <Button
              variant="secondary"
              label={copy.actions.testPhoto}
              disabled={busy}
              onPress={onTestPhoto}
            />
          )}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  tile: { borderRadius: radii.card, backgroundColor: colors.white },
  // The border is 1 pt when idle and 2 pt when selected (the same style as the O01 choice cards);
  // the padding makes up the difference so nothing shifts.
  tileIdle: { padding: space[16] - 1, borderWidth: 1, borderColor: colors.line },
  tileSelected: {
    padding: space[16] - 2,
    borderWidth: 2,
    borderColor: colors.cobalt,
    boxShadow: '0 8px 16px rgba(40, 88, 200, 0.16)',
  },
  header: { minHeight: THUMBNAIL, flexDirection: 'row', alignItems: 'center', gap: space[16] },
  thumbnail: { width: THUMBNAIL, height: THUMBNAIL, borderRadius: radii.field },
  text: { flex: 1, gap: 4 },
  title: { ...textStyle(type.cardTitle), color: colors.deepBlue },
  status: { ...textStyle(type.body), color: colors.slate },
  body: { gap: space[8], paddingTop: space[16] },
  hint: { ...textStyle(type.body), color: colors.slate },
})
