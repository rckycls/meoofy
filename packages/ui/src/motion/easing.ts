import { View } from 'react-native'
import { Easing, createAnimatedComponent } from 'react-native-reanimated'

import type { Bezier } from '../theme/tokens'

/** A token curve as a Reanimated easing for `withTiming`. */
export function bezierEasing([x1, y1, x2, y2]: Bezier) {
  return Easing.bezier(x1, y1, x2, y2)
}

/** `View` that accepts animated styles. Same component as Reanimated's `Animated.View`. */
export const AnimatedView = createAnimatedComponent(View)
