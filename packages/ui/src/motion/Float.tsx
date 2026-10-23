import { useEffect, type ReactNode } from 'react'
import { View } from 'react-native'
import {
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

import { AnimatedView, bezierEasing } from './easing'
import { floatMotion } from './presets'
import { resolveMotion } from './resolveMotion'
import { useMotionPreference } from './useMotionPreference'

export type FloatProps = {
  children?: ReactNode
  /** Position in a group: the loop starts `index x 400` ms late so stickers drift out of step. */
  index: number
}

/**
 * A sticker that bobs up 10 px and tilts 2 degrees either way on a 3.2 s
 * loop. With Reduce Motion on it is not animated at all: the children render
 * in a plain view.
 */
export function Float({ children, index }: FloatProps) {
  const { reduced } = useMotionPreference()
  const spec = resolveMotion('float', reduced)
  const looping = spec.kind === 'loop'
  const progress = useSharedValue(0)
  const [x1, y1, x2, y2] = spec.easing

  useEffect(() => {
    if (!looping) return
    // `duration` is a full cycle; the loop rises for half of it and falls back for the rest.
    progress.value = withDelay(
      index * floatMotion.stagger,
      withRepeat(
        withTiming(1, { duration: spec.duration / 2, easing: bezierEasing([x1, y1, x2, y2]) }),
        -1,
        true,
      ),
    )
    return () => {
      cancelAnimation(progress)
      progress.value = 0
    }
  }, [looping, index, spec.duration, x1, y1, x2, y2, progress])

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [0, -floatMotion.distance]) },
      {
        rotate: `${interpolate(
          progress.value,
          [0, 1],
          [-floatMotion.tiltDegrees, floatMotion.tiltDegrees],
        )}deg`,
      },
    ],
  }))

  if (!looping) return <View testID="float">{children}</View>

  return (
    <AnimatedView testID="float" style={style}>
      {children}
    </AnimatedView>
  )
}
