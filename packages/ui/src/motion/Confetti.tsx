import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import {
  Easing,
  Extrapolation,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'

import { colors } from '../theme/tokens'
import { AnimatedView, bezierEasing } from './easing'
import { resolveMotion } from './resolveMotion'
import { useMotionPreference } from './useMotionPreference'

export type ConfettiProps = {
  /** The burst plays each time this turns true. */
  active: boolean
}

type ConfettiPiece = {
  /** Where the piece ends up relative to the burst point, in px (before it falls). */
  dx: number
  dy: number
  /** Total rotation in degrees. */
  spin: number
  size: number
  color: string
  round: boolean
}

const PIECE_COUNT = 18
/** How far the pieces drop by the end of the burst, in px. */
const FALL_DISTANCE = 140
const PALETTE = [
  colors.blush,
  colors.moonYellow,
  colors.sky,
  colors.twilight,
  colors.iris,
  colors.peach,
] as const

/**
 * The pieces of one burst. They fan out evenly around the burst point with a
 * fixed pattern of distances, sizes and spins, so a burst looks the same on
 * every render and in every test.
 */
function confettiPieces(count: number = PIECE_COUNT): ConfettiPiece[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * 2 * Math.PI
    const reach = 80 + ((i * 7) % 5) * 28
    return {
      dx: Math.cos(angle) * reach,
      // Biased upwards so the burst pops up before gravity pulls it down.
      dy: Math.sin(angle) * reach - 40,
      spin: (i % 2 === 0 ? 1 : -1) * (240 + ((i * 47) % 240)),
      size: 8 + (i % 3) * 2,
      color: PALETTE[i % PALETTE.length],
      round: i % 4 === 0,
    }
  })
}

const pieces = confettiPieces()

type PieceViewProps = {
  piece: ConfettiPiece
  /** 0 to 1 on the burst curve: drives the spread and the spin. */
  burst: SharedValue<number>
  /** 0 to 1 on a straight line: drives gravity and the fade-out. */
  time: SharedValue<number>
}

function PieceView({ piece, burst, time }: PieceViewProps) {
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(time.value, [0, 0.08, 0.7, 1], [0, 1, 1, 0], Extrapolation.CLAMP),
    transform: [
      { translateX: piece.dx * burst.value },
      { translateY: piece.dy * burst.value + FALL_DISTANCE * time.value * time.value },
      { rotate: `${piece.spin * burst.value}deg` },
    ],
  }))

  return (
    <AnimatedView
      testID="confetti-piece"
      style={[
        styles.piece,
        {
          width: piece.size,
          height: piece.round ? piece.size : piece.size * 0.5,
          marginLeft: -piece.size / 2,
          borderRadius: piece.round ? piece.size / 2 : 1,
          backgroundColor: piece.color,
        },
        style,
      ]}
    />
  )
}

/**
 * A 900 ms burst of confetti from the centre of its parent, for the "all set"
 * moment. It is decoration: hidden from assistive tech and never intercepts
 * touches. With Reduce Motion on it draws nothing.
 */
export function Confetti({ active }: ConfettiProps) {
  const { reduced } = useMotionPreference()
  const spec = resolveMotion('confetti', reduced)
  const bursting = active && spec.kind === 'timing'
  const burst = useSharedValue(0)
  const time = useSharedValue(0)
  const [x1, y1, x2, y2] = spec.easing

  useEffect(() => {
    if (!bursting) return
    burst.value = 0
    time.value = 0
    burst.value = withTiming(1, { duration: spec.duration, easing: bezierEasing([x1, y1, x2, y2]) })
    time.value = withTiming(1, { duration: spec.duration, easing: Easing.linear })
    return () => {
      cancelAnimation(burst)
      cancelAnimation(time)
    }
  }, [bursting, spec.duration, x1, y1, x2, y2, burst, time])

  if (!bursting) return null

  return (
    <View
      testID="confetti"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      style={styles.layer}
    >
      {pieces.map((piece, i) => (
        <PieceView key={i} piece={piece} burst={burst} time={time} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, pointerEvents: 'none' },
  // Pieces start at the centre of the layer and move out from there.
  piece: { position: 'absolute', top: '50%', left: '50%' },
})
