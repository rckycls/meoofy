import { resolveMotion, useMotionPreference } from '@meoofy/ui'

export type StepTransition = {
  animation: 'fade' | 'fade_from_bottom'
  /** Milliseconds. */
  animationDuration: number
}

/**
 * The `moonrise` step transition (360 ms) as native-stack options. The native
 * stack takes no custom curve, so the nearest built-in is used: the screen
 * fades in from the bottom for the preset's duration. With Reduce Motion on the
 * preset turns into its 160 ms fade and nothing moves.
 */
export function stepTransition(reduced: boolean): StepTransition {
  const spec = resolveMotion('moonrise', reduced)
  return {
    animation: spec.kind === 'fade' ? 'fade' : 'fade_from_bottom',
    animationDuration: spec.duration,
  }
}

export function useStepTransition(): StepTransition {
  const { reduced } = useMotionPreference()
  return stepTransition(reduced)
}
