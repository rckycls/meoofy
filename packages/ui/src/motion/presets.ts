import { motion, type Bezier } from '../theme/tokens'

export type MotionPreset = 'peel' | 'float' | 'twinkle' | 'pawTrail' | 'moonrise' | 'confetti'

/**
 * - `timing`: one run of `duration` ms.
 * - `loop`: repeats forever; `duration` is one full cycle.
 * - `fade`: opacity only (the Reduce Motion stand-in for an entrance).
 * - `none`: nothing moves.
 */
export type MotionKind = 'timing' | 'loop' | 'fade' | 'none'

export type MotionSpec = {
  kind: MotionKind
  /** Milliseconds. Zero when nothing moves. */
  duration: number
  easing: Bezier
  loop: boolean
}

/** What a preset does at full motion, and what replaces it under Reduce Motion. */
export type PresetDefinition = {
  kind: 'timing' | 'loop'
  duration: number
  easing: Bezier
  /** Entrances fade in; decorative loops and bursts are dropped. */
  whenReduced: 'fade' | 'none'
}

/** The moonrise step transition (spec section 8); it has no token of its own. */
const MOONRISE_DURATION = 360

export const presets: Record<MotionPreset, PresetDefinition> = {
  peel: {
    kind: 'timing',
    duration: motion.duration.gentle,
    easing: motion.easing.peel,
    whenReduced: 'fade',
  },
  float: {
    kind: 'loop',
    duration: motion.duration.floatLoop,
    easing: motion.easing.float,
    whenReduced: 'none',
  },
  twinkle: {
    kind: 'loop',
    duration: motion.duration.twinkle,
    easing: motion.easing.float,
    whenReduced: 'none',
  },
  // The duration is one paw print; the trail staggers prints by the same amount.
  pawTrail: {
    kind: 'timing',
    duration: motion.stagger.trail,
    easing: motion.easing.standard,
    whenReduced: 'fade',
  },
  moonrise: {
    kind: 'timing',
    duration: MOONRISE_DURATION,
    easing: motion.easing.standard,
    whenReduced: 'fade',
  },
  confetti: {
    kind: 'timing',
    duration: motion.duration.burst,
    easing: motion.easing.burst,
    whenReduced: 'none',
  },
}

/** The Reduce Motion fade: 160 ms of opacity, no movement. */
export const reducedFade: MotionSpec = {
  kind: 'fade',
  duration: motion.duration.fast,
  easing: motion.easing.standard,
  loop: false,
}

/** Used when Reduce Motion removes an animation altogether. */
export const stillness: MotionSpec = {
  kind: 'none',
  duration: 0,
  easing: motion.easing.standard,
  loop: false,
}

/** Float: how far a sticker rises (px) and how far it tilts either way (degrees). */
export const floatMotion = {
  distance: motion.floatDistance,
  tiltDegrees: 2,
  /** Delay added per sticker so a group never moves in step (ms). */
  stagger: motion.stagger.float,
} as const
