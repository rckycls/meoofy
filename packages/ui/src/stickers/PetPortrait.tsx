import { StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'

import { cardRoles, flowTints, type Flow } from '../theme/roles'
import { radii, space } from '../theme/tokens'
import { textStyle } from '../theme/textStyle'
import { type } from '../theme/type'
import { Sticker } from './Sticker'

/** Defined here, not imported from `@pawpin/core`: the UI package stays free of domain code. */
export type PetSpecies = 'dog' | 'cat'

export type PetPortraitProps = {
  species: PetSpecies
  flow: Flow
  width: number
  height: number
  /** Shown in a pill at the bottom, e.g. "Luna photo". */
  label?: string
}

/** Below this height the sticker takes up more of the box so it stays legible. */
const COMPACT_HEIGHT = 160
const COMPACT_RATIO = 0.72
const REGULAR_RATIO = 0.6
const HALO_RATIO = 1.18
const SPARKLE_RATIO = 0.36
const SPARKLE_TILT = 12
// A translucent white, so the flow gradient shows through the halo.
const HALO = 'rgba(255, 255, 255, 0.6)'

/**
 * Stands in for a pet photo: a diagonal gradient in the flow's colours, a white
 * halo, the species sticker, one sparkle and an optional label pill.
 */
export function PetPortrait({ species, flow, width, height, label }: PetPortraitProps) {
  const tints = flowTints[flow]
  const stickerSize = height * (height < COMPACT_HEIGHT ? COMPACT_RATIO : REGULAR_RATIO)
  const haloSize = stickerSize * HALO_RATIO

  return (
    <View
      testID="pet-portrait"
      style={[
        styles.portrait,
        { width, height, borderRadius: Math.min(radii.card, Math.min(width, height) / 2) },
      ]}
    >
      <LinearGradient
        testID="portrait-gradient"
        colors={[tints.glowA, tints.glowB]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View
        aria-hidden
        testID="portrait-halo"
        style={{
          width: haloSize,
          height: haloSize,
          borderRadius: haloSize / 2,
          backgroundColor: HALO,
          position: 'absolute',
        }}
      />
      <Sticker name={species} size={stickerSize} />
      <View style={[styles.sparkle, { top: height * 0.1, right: width * 0.1 }]}>
        <Sticker name="sparkle" size={stickerSize * SPARKLE_RATIO} rotate={SPARKLE_TILT} />
      </View>
      {label ? (
        <View style={styles.labelRow}>
          <View
            testID="portrait-label"
            style={[styles.pill, { maxWidth: Math.max(0, width - space[16]) }]}
          >
            <Text numberOfLines={1} style={styles.label}>
              {label}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  portrait: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkle: { position: 'absolute' },
  labelRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: space[8],
    alignItems: 'center',
  },
  // The plain card role pair: deep blue on white, already on the AA-checked list.
  pill: {
    backgroundColor: cardRoles.plain.from,
    borderRadius: radii.chip,
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  label: { ...textStyle(type.caption), color: cardRoles.plain.title },
})
