import { useEffect, type ReactNode } from 'react'
import {
  Extrapolation,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated'

import { AnimatedView, bezierEasing } from './easing'
import { resolveMotion } from './resolveMotion'
import { useMotionPreference } from './useMotionPreference'

export type PeelProps = {
  children?: ReactNode
  /** Milliseconds to wait before the entrance starts. */
  delay?: number
}

/** Where a sticker starts before it peels in. */
const START_SCALE = 0.6
const START_TILT_DEGREES = -8

/**
 * Entrance for a sticker: it peels in with a springy overshoot. With Reduce
 * Motion on it only fades in over 160 ms.
 *
 * The wrapper never blocks touches, so a button inside responds from the
 * first frame even while it is still fading in.
 */
export function Peel({ children, delay = 0 }: PeelProps) {
  const { reduced } = useMotionPreference()
  const spec = resolveMotion('peel', reduced)
  const peels = spec.kind === 'timing'
  const progress = useSharedValue(0)
  const [x1, y1, x2, y2] = spec.easing

  useEffect(() => {
    // Not reset to 0: if Reduce Motion flips after the entrance has finished,
    // the target is already reached and nothing replays.
    progress.value = withDelay(
      delay,
      withTiming(1, { duration: spec.duration, easing: bezierEasing([x1, y1, x2, y2]) }),
    )
    return () => cancelAnimation(progress)
  }, [delay, spec.duration, x1, y1, x2, y2, progress])

  const style = useAnimatedStyle(() => {
    const p = progress.value
    if (!peels) {
      // Reduce Motion: opacity only. The transform is pinned to rest rather
      // than left out, because Reanimated does not clear a style key that
      // disappears, so a switch mid-peel would freeze the sticker tilted.
      return {
        opacity: interpolate(p, [0, 1], [0, 1], Extrapolation.CLAMP),
        transform: [{ scale: 1 }, { rotate: '0deg' }],
      }
    }
    return {
      opacity: interpolate(p, [0, 0.4], [0, 1], Extrapolation.CLAMP),
      // Not clamped on purpose: the curve overshoots 1, which is the peel.
      transform: [
        { scale: interpolate(p, [0, 1], [START_SCALE, 1]) },
        { rotate: `${interpolate(p, [0, 1], [START_TILT_DEGREES, 0])}deg` },
      ],
    }
  })

  return (
    <AnimatedView testID="peel" style={style}>
      {children}
    </AnimatedView>
  )
}
