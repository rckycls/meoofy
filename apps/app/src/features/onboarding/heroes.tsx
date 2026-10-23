import { useEffect, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg'
import {
  Confetti,
  Float,
  Peel,
  Sticker,
  Twinkle,
  colors,
  motion,
  radii,
  resolveMotion,
  useMotionPreference,
  type StickerName,
} from '@pawpin/ui'

/** The hero is 268 pt tall at every width (board 08). */
export const HERO_HEIGHT = 268

// Positions below are in px on the board's 342 x 268 hero. They are laid out
// as percentages, so the scene spreads out in a wider column; the stickers
// keep their size.
const BOARD_WIDTH = 342

/** Delay between one sticker's entrance and the next. */
const PEEL_STAGGER = 100

type Gradient = {
  colors: readonly [string, string, ...string[]]
  start: { x: number; y: number }
  end: { x: number; y: number }
}

// The scene backgrounds are hand-matched to board 08. They are art, not roles,
// so they live with the art.
const skyGradient: Gradient = {
  colors: ['#C9E6FF', '#92B5F3', '#7692E6'],
  start: { x: 0.1, y: 0 },
  end: { x: 0.9, y: 1 },
}
const dawnGradient: Gradient = {
  colors: ['#D5EAFF', '#E4E4FF', colors.lavender],
  start: { x: 0.5, y: 0 },
  end: { x: 0.5, y: 1 },
}
const celebrationGradient: Gradient = {
  colors: ['#FFF1B0', colors.petal, '#E3DCFF'],
  start: { x: 0.1, y: 0 },
  end: { x: 0.9, y: 1 },
}

const HILL = 'rgba(255, 255, 255, 0.55)'
const ISLAND = 'rgba(255, 255, 255, 0.85)'
const RING = 'rgba(255, 255, 255, 0.85)'
const STAR = 'rgba(255, 255, 255, 0.9)'

type HeroFrameProps = {
  testID: string
  gradient: Gradient
  children: ReactNode
}

/**
 * The rounded scene card. The whole scene is decoration, so it is hidden from
 * VoiceOver, TalkBack and the web accessibility tree; the screen's text says
 * everything the art does.
 */
function HeroFrame({ testID, gradient, children }: HeroFrameProps) {
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      style={styles.hero}
    >
      <LinearGradient
        colors={gradient.colors}
        start={gradient.start}
        end={gradient.end}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  )
}

type PlacedProps = { x: number; y: number; size: number; children?: ReactNode }

/** A square box centred on a board position. */
function Placed({ x, y, size, children }: PlacedProps) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: `${(x / BOARD_WIDTH) * 100}%`,
        top: `${(y / HERO_HEIGHT) * 100}%`,
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginTop: -size / 2,
      }}
    >
      {children}
    </View>
  )
}

type StickerSpec = { name: StickerName; x: number; y: number; size: number; rotate?: number }

/** Stickers peel in one after another, then drift on staggered float loops. */
function Stickers({ items }: { items: readonly StickerSpec[] }) {
  return items.map((item, index) => (
    <Placed key={`${item.name}-${index}`} x={item.x} y={item.y} size={item.size}>
      <Peel delay={index * PEEL_STAGGER}>
        <Float index={index}>
          <Sticker name={item.name} size={item.size} rotate={item.rotate} />
        </Float>
      </Peel>
    </Placed>
  ))
}

type SparkleSpec = { x: number; y: number; size: number; rotate?: number }

function Sparkles({ items }: { items: readonly SparkleSpec[] }) {
  return items.map((item, index) => (
    <Placed key={index} x={item.x} y={item.y} size={item.size}>
      <Twinkle>
        <Sticker name="sparkle" size={item.size} rotate={item.rotate} />
      </Twinkle>
    </Placed>
  ))
}

/** Tiny stars: plain dots, so they cost nothing. */
function Stars({ items }: { items: readonly (readonly [number, number, number])[] }) {
  return items.map(([x, y, size], index) => (
    <Placed key={index} x={x} y={y} size={size}>
      <View style={{ flex: 1, borderRadius: size / 2, backgroundColor: STAR }} />
    </Placed>
  ))
}

type GlowDiscProps = { id: string; radius: number; color: string }

/** A soft round glow: a radial gradient from the colour to nothing. */
function GlowDisc({ id, radius, color }: GlowDiscProps) {
  const size = radius * 2
  return (
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={0.95} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width={size} height={size} fill={`url(#${id})`} />
    </Svg>
  )
}

function Glow({ x, y, ...disc }: GlowDiscProps & { x: number; y: number }) {
  return (
    <Placed x={x} y={y} size={disc.radius * 2}>
      <GlowDisc {...disc} />
    </Placed>
  )
}

function Ellipse({
  x,
  y,
  width,
  height,
  color,
}: {
  x: number
  y: number
  width: number
  height: number
  color: string
}) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: `${(x / BOARD_WIDTH) * 100}%`,
        top: `${(y / HERO_HEIGHT) * 100}%`,
        width,
        height,
        marginLeft: -width / 2,
        marginTop: -height / 2,
        // An elliptical corner: the box is drawn as an ellipse.
        borderRadius: '50%',
        backgroundColor: color,
      }}
    />
  )
}

function Ring({ x, y, diameter }: { x: number; y: number; diameter: number }) {
  return (
    <Placed x={x} y={y} size={diameter}>
      <View
        style={{
          flex: 1,
          borderRadius: diameter / 2,
          borderWidth: 1.5,
          borderColor: RING,
        }}
      />
    </Placed>
  )
}

const TRAIL_DOT = 6

/** One dot of the paw trail: it draws in `pawTrail` ms after the dot before it. */
function TrailDot({ x, y, index }: { x: number; y: number; index: number }) {
  const { reduced } = useMotionPreference()
  const spec = resolveMotion('pawTrail', reduced)
  const progress = useSharedValue(0)
  const [x1, y1, x2, y2] = spec.easing
  // With Reduce Motion on the dots fade in together instead of one by one.
  const delay = spec.kind === 'timing' ? index * motion.stagger.trail : 0

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withTiming(1, { duration: spec.duration, easing: Easing.bezier(x1, y1, x2, y2) }),
    )
    return () => cancelAnimation(progress)
  }, [delay, spec.duration, x1, y1, x2, y2, progress])

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: spec.kind === 'timing' ? 0.4 + 0.6 * progress.value : 1 }],
  }))

  return (
    <Placed x={x} y={y} size={TRAIL_DOT}>
      <Animated.View
        testID="trail-dot"
        style={[styles.trailDot, { borderRadius: TRAIL_DOT / 2 }, style]}
      />
    </Placed>
  )
}

/** O00: the night garden. */
export function NightGardenHero() {
  return (
    <HeroFrame testID="hero-night-garden" gradient={skyGradient}>
      <Glow id="glow-night-garden" x={194} y={112} radius={112} color={colors.softYellow} />
      <Stars
        items={[
          [35, 37, 3],
          [102, 24, 3],
          [134, 70, 3],
          [217, 29, 3],
          [162, 91, 3],
          [310, 52, 3],
        ]}
      />
      <Ellipse x={72} y={286} width={300} height={170} color={HILL} />
      <Ellipse x={256} y={314} width={380} height={170} color={HILL} />
      <Sparkles
        items={[
          { x: 119, y: 40, size: 30 },
          { x: 159, y: 100, size: 30 },
          { x: 306, y: 155, size: 24 },
        ]}
      />
      <Stickers
        items={[
          { name: 'dog', x: 93, y: 162, size: 116, rotate: -4 },
          { name: 'cat', x: 234, y: 162, size: 104, rotate: 4 },
          { name: 'sleepy-moon', x: 286, y: 52, size: 66, rotate: 6 },
        ]}
      />
    </HeroFrame>
  )
}

/** O01: two paths, a dog on one island and a pin on the other. */
export function TwoPathsHero() {
  return (
    <HeroFrame testID="hero-two-paths" gradient={dawnGradient}>
      <Glow id="glow-two-paths" x={174} y={82} radius={96} color={colors.softYellow} />
      <Stars
        items={[
          [30, 31, 3],
          [307, 37, 3],
          [74, 128, 3],
        ]}
      />
      <Ellipse x={91} y={222} width={150} height={52} color={ISLAND} />
      <Ellipse x={251} y={222} width={150} height={52} color={ISLAND} />
      {[
        [127, 115],
        [145, 106],
        [164, 102],
        [183, 102],
        [202, 108],
        [218, 118],
      ].map(([x, y], index) => (
        <TrailDot key={index} x={x} y={y} index={index} />
      ))}
      <Sparkles
        items={[
          { x: 201, y: 66, size: 26, rotate: 10 },
          { x: 139, y: 139, size: 26, rotate: -8 },
        ]}
      />
      <Stickers
        items={[
          { name: 'dog', x: 90, y: 160, size: 112, rotate: -3 },
          { name: 'paw-pin', x: 261, y: 144, size: 104 },
          { name: 'heart-paw', x: 170, y: 53, size: 52, rotate: -6 },
        ]}
      />
    </HeroFrame>
  )
}

/** O02: safe orbit, a shield with the rings of care around it. */
export function SafeOrbitHero() {
  return (
    <HeroFrame testID="hero-safe-orbit" gradient={dawnGradient}>
      <Ring x={171} y={147} diameter={298} />
      <Ring x={171} y={135} diameter={199} />
      <Stars
        items={[
          [128, 12, 3],
          [307, 60, 3],
          [47, 205, 3],
        ]}
      />
      {/* The glow breathes on the 1.6 s twinkle loop; the shield only drifts. */}
      <Placed x={170} y={134} size={190}>
        <Twinkle>
          <GlowDisc id="glow-safe-orbit" radius={95} color={colors.softYellow} />
        </Twinkle>
      </Placed>
      <Sparkles
        items={[
          { x: 258, y: 57, size: 28, rotate: 8 },
          { x: 75, y: 166, size: 22, rotate: -8 },
        ]}
      />
      <Stickers
        items={[
          { name: 'privacy-shield', x: 170, y: 134, size: 132 },
          { name: 'love-letter', x: 60, y: 82, size: 88, rotate: -12 },
          { name: 'sleepy-moon', x: 277, y: 188, size: 52, rotate: 8 },
        ]}
      />
    </HeroFrame>
  )
}

/** O03: celebration. Confetti bursts once, then the stickers drift. */
export function CelebrationHero() {
  return (
    <HeroFrame testID="hero-celebration" gradient={celebrationGradient}>
      <Glow id="glow-celebration" x={174} y={150} radius={104} color={colors.white} />
      <Sparkles
        items={[
          { x: 92, y: 77, size: 28 },
          { x: 277, y: 98, size: 24 },
          { x: 232, y: 241, size: 30 },
        ]}
      />
      <Stickers
        items={[
          { name: 'rainbow', x: 170, y: 82, size: 154 },
          { name: 'pet-tag', x: 174, y: 172, size: 98, rotate: 8 },
          { name: 'shooting-star', x: 57, y: 148, size: 64 },
          { name: 'heart-paw', x: 272, y: 174, size: 64, rotate: 10 },
        ]}
      />
      <Confetti active />
    </HeroFrame>
  )
}

const styles = StyleSheet.create({
  hero: {
    width: '100%',
    height: HERO_HEIGHT,
    borderRadius: radii.card,
    overflow: 'hidden',
  },
  trailDot: { flex: 1, backgroundColor: colors.white },
})
