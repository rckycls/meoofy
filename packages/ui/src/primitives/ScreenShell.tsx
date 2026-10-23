import { useEffect, useState, type ReactNode } from 'react'
import {
  AccessibilityInfo,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native'
import { BlurView } from 'expo-blur'
import { LinearGradient } from 'expo-linear-gradient'

import { flowTints, type Flow } from '../theme/roles'
import { colors, space } from '../theme/tokens'
import { useInsets } from './safeArea'

export type ShellEdge = 'top' | 'right' | 'bottom' | 'left'

export type ScreenShellProps = {
  flow: Flow
  children?: ReactNode
  /** Scroll the content (Dynamic Type grows text, so most screens should). */
  scroll?: boolean
  /**
   * Edges that get safe-area padding. All four by default; a screen above the
   * tab bar passes `['top', 'left', 'right']` because the bar covers the rest.
   */
  edges?: readonly ShellEdge[]
}

const allEdges: readonly ShellEdge[] = ['top', 'right', 'bottom', 'left']

/** Middle stop of the background gradient (from the component library). */
const GRADIENT_MIDDLE = '#F7F5FF'

const GLOW_SIZE = 320
/** Each glow hangs this far past its screen corner, so only the inner part shows. */
const GLOW_OFFSET = -(space[64] + space[32])
const GLOW_BLUR_PX = 60
const GLOW_BLUR_INTENSITY = 50

/**
 * With Reduce Transparency on, iOS draws a blur view as a flat opaque fill,
 * which would hide the whole background. Without a real blur the glows would
 * be hard-edged discs, so the shell drops them and keeps the gradient.
 */
function useReduceTransparency(enabled: boolean): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let mounted = true
    void AccessibilityInfo.isReduceTransparencyEnabled().then((value) => {
      if (mounted) setReduced(value)
    })
    const subscription = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduced)
    return () => {
      mounted = false
      subscription.remove()
    }
  }, [enabled])

  return reduced
}

export function ScreenShell({
  flow,
  children,
  scroll = false,
  edges = allEdges,
}: ScreenShellProps) {
  const tints = flowTints[flow]
  const insets = useInsets()
  const onWeb = Platform.OS === 'web'
  const reduceTransparency = useReduceTransparency(!onWeb)
  const inset = (edge: ShellEdge) => (edges.includes(edge) ? insets[edge] : 0)
  const padding: ViewStyle = {
    paddingTop: inset('top') + space[16],
    paddingBottom: inset('bottom') + space[16],
    paddingLeft: inset('left') + space[24],
    paddingRight: inset('right') + space[24],
  }
  // iOS and web are the targets: iOS blurs through expo-blur, the web through
  // a CSS filter.
  const webBlur: ViewStyle | null = onWeb ? { filter: `blur(${GLOW_BLUR_PX}px)` } : null

  return (
    <View style={styles.root}>
      <LinearGradient
        testID="screen-gradient"
        colors={[tints.tint, GRADIENT_MIDDLE, colors.cloud]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.layer}
      />
      {reduceTransparency ? null : (
        <>
          <View
            aria-hidden
            testID="glow-a"
            style={[
              styles.glow,
              { top: GLOW_OFFSET, right: GLOW_OFFSET, backgroundColor: tints.glowA },
              webBlur,
            ]}
          />
          <View
            aria-hidden
            testID="glow-b"
            style={[
              styles.glow,
              { bottom: GLOW_OFFSET, left: GLOW_OFFSET, backgroundColor: tints.glowB },
              webBlur,
            ]}
          />
          {onWeb ? null : (
            // One blur over the gradient and both glows softens their edges.
            // A blur view per glow would end in a visible edge of its own.
            // The tint is fixed to a light one so dark mode cannot grey the
            // pastel background.
            <BlurView
              testID="glow-blur"
              tint="extraLight"
              intensity={GLOW_BLUR_INTENSITY}
              style={styles.layer}
            />
          )}
        </>
      )}
      {scroll ? (
        <ScrollView
          testID="screen-content"
          style={styles.fill}
          contentContainerStyle={[styles.scrollContent, padding]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View testID="screen-content" style={[styles.fill, padding]}>
          {children}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden', backgroundColor: colors.cloud },
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, pointerEvents: 'none' },
  glow: {
    position: 'absolute',
    width: GLOW_SIZE,
    height: GLOW_SIZE,
    borderRadius: GLOW_SIZE / 2,
    pointerEvents: 'none',
  },
  fill: { flex: 1 },
  scrollContent: { flexGrow: 1 },
})
