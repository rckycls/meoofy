import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Linking, Modal, StyleSheet, Text, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as ImagePicker from 'expo-image-picker'
import {
  Button,
  Card,
  ScreenShell,
  cardRoles,
  colors,
  radii,
  space,
  textStyle,
  type,
} from '@pawpin/ui'

import { ContentColumn } from '../../layout/ContentColumn'
import type { GuidedView } from '../../photo/views'
import { ProblemNote } from '../auth/ProblemNote'
import { photosCopy as copy } from './copy'

/**
 * Opens the photo library for one image. Resolves with its URI, or `null` when the person closes
 * the library without choosing. (On the web this is the browser's file chooser.) This and
 * `CameraSheet` are the app's only uses of the camera and the picker.
 */
export async function pickFromLibrary(): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
  })
  return result.canceled ? null : (result.assets[0]?.uri ?? null)
}

export type CameraSheetProps = {
  /** The view being photographed; it names the sheet and says what to show. */
  view: GuidedView
  /** A photo was taken, or chosen from the library (the S02 way round a camera that is off). */
  onPhoto: (uri: string) => void
  onClose: () => void
}

/**
 * The camera, in a sheet over the screen, with a frame to line the pet up in. The sheet is open
 * for as long as it is mounted.
 *
 * It asks for the camera when it opens, if the system lets it. When the camera is off for PawPin
 * (S02), or the device has none to start, it says so and offers the photo library instead.
 */
export function CameraSheet({ view, onPhoto, onClose }: CameraSheetProps) {
  const [permission, requestPermission] = useCameraPermissions()
  const camera = useRef<CameraView>(null)
  const [requested, setRequested] = useState(false)
  const [asking, setAsking] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [taking, setTaking] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const mustAsk = permission !== null && !permission.granted && permission.canAskAgain && !requested

  useEffect(() => {
    if (!mustAsk) return
    setRequested(true)
    setAsking(true)
    requestPermission()
      .catch(() => undefined)
      .finally(() => setAsking(false))
  }, [mustAsk, requestPermission])

  async function shoot() {
    if (taking) return
    setTaking(true)
    setNote(null)
    try {
      const picture = await camera.current?.takePictureAsync()
      if (picture !== undefined) onPhoto(picture.uri)
    } catch {
      setNote(copy.camera.captureFailed)
    } finally {
      setTaking(false)
    }
  }

  async function chooseFromLibrary() {
    setNote(null)
    let uri: string | null
    try {
      uri = await pickFromLibrary()
    } catch {
      setNote(copy.sourceFailed)
      return
    }
    if (uri !== null) onPhoto(uri)
  }

  const starting = permission === null || asking || mustAsk
  const showCamera = !starting && permission.granted && !unavailable
  const explanation = unavailable ? copy.camera.unavailable : copy.camera.off
  // Settings is where a camera that was refused is turned back on.
  const settingsHelp = !unavailable && permission !== null && !permission.canAskAgain

  return (
    <Modal visible animationType="none" onRequestClose={onClose}>
      <ScreenShell flow="owner" scroll>
        <ContentColumn style={styles.column}>
          <Text accessibilityRole="header" style={styles.title}>
            {copy.camera.title(view)}
          </Text>

          {starting ? (
            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={copy.camera.starting}
              style={styles.starting}
            >
              <ActivityIndicator color={colors.cobalt} />
            </View>
          ) : showCamera ? (
            <>
              <View style={styles.preview}>
                <CameraView
                  ref={camera}
                  facing="back"
                  style={StyleSheet.absoluteFill}
                  onMountError={() => setUnavailable(true)}
                />
                {/* The frame to line the pet up in: decoration, the hint below says the same. */}
                <View aria-hidden pointerEvents="none" style={styles.frame} />
              </View>
              <Text style={styles.hint}>{copy.views[view].hint}</Text>
              <Button
                variant="primary"
                label={copy.camera.shutter(view)}
                loading={taking}
                onPress={() => void shoot()}
              />
            </>
          ) : (
            <>
              <View testID="camera-off">
                <Card role="warning" title={explanation.title}>
                  <Text style={[styles.body, { color: cardRoles.warning.body }]}>
                    {explanation.body}
                  </Text>
                </Card>
              </View>
              <Button
                variant="primary"
                label={copy.camera.off.upload}
                onPress={() => void chooseFromLibrary()}
              />
              {settingsHelp ? (
                <Button
                  variant="secondary"
                  label={copy.camera.off.settings}
                  onPress={() => void Linking.openSettings()}
                />
              ) : null}
            </>
          )}

          {note === null ? null : <ProblemNote>{note}</ProblemNote>}
          <Button variant="secondary" label={copy.camera.cancel} onPress={onClose} />
        </ContentColumn>
      </ScreenShell>
    </Modal>
  )
}

const styles = StyleSheet.create({
  column: { gap: space[16] },
  title: { ...textStyle(type.headline), color: colors.deepBlue },
  starting: { paddingVertical: space[32] },
  preview: {
    width: '100%',
    aspectRatio: 3 / 4,
    overflow: 'hidden',
    borderRadius: radii.card,
    backgroundColor: colors.deepBlue,
  },
  frame: {
    position: 'absolute',
    top: '10%',
    bottom: '10%',
    left: '12%',
    right: '12%',
    borderWidth: 2,
    borderColor: colors.white,
    borderRadius: radii.card,
  },
  hint: { ...textStyle(type.body), color: colors.slate },
  body: textStyle(type.body),
})
