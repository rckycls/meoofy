import { useEffect, type ReactNode } from 'react'
import { View } from 'react-native'
import {
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

import { AnimatedView, bezierEasing } from './easing'
import { resolveMotion } from './resolveMotion'
import { useMotionPreference } from './useMotionPreference'

export type TwinkleProps = {
  children?: ReactNode
}

/** How dim and small a sparkle gets at the bottom of a twinkle. */
const DIM_OPACITY = 0.45
const SHRUNK_SCALE = 0.85

/**
 * A sparkle that pulses on a 1.6 s loop. With Reduce Motion on it is not
 * animated at all: the children render in a plain view.
 */
export function Twinkle({ children }: TwinkleProps) {
  const { reduced } = useMotionPreference()
  const spec = resolveMotion('twinkle', reduced)
  const looping = spec.kind === 'loop'
  const progress = useSharedValue(0)
  const [x1, y1, x2, y2] = spec.easing

  useEffect(() => {
    if (!looping) return
    // `duration` is a full cycle: half dimming, half coming back.
    progress.value = withRepeat(
      withTiming(1, { duration: spec.duration / 2, easing: bezierEasing([x1, y1, x2, y2]) }),
      -1,
      true,
    )
    return () => {
      cancelAnimation(progress)
      progress.value = 0
    }
  }, [looping, spec.duration, x1, y1, x2, y2, progress])

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [1, DIM_OPACITY]),
    transform: [{ scale: interpolate(progress.value, [0, 1], [1, SHRUNK_SCALE]) }],
  }))

  if (!looping) return <View testID="twinkle">{children}</View>

  return (
    <AnimatedView testID="twinkle" style={style}>
      {children}
    </AnimatedView>
  )
}
