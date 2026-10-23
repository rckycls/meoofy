import { presets, reducedFade, stillness, type MotionPreset, type MotionSpec } from './presets'

export type { MotionKind, MotionPreset, MotionSpec } from './presets'

/**
 * The motion a preset should run. With Reduce Motion on, loops and bursts
 * stop and entrances become a 160 ms opacity fade.
 */
export function resolveMotion(preset: MotionPreset, reduced: boolean): MotionSpec {
  const definition = presets[preset]
  if (!reduced) {
    return {
      kind: definition.kind,
      duration: definition.duration,
      easing: definition.easing,
      loop: definition.kind === 'loop',
    }
  }
  return definition.whenReduced === 'fade' ? { ...reducedFade } : { ...stillness }
}
