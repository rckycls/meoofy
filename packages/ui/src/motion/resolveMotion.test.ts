import { motion } from '../theme/tokens'
import { resolveMotion, type MotionPreset } from './resolveMotion'

const presets: readonly MotionPreset[] = [
  'peel',
  'float',
  'twinkle',
  'pawTrail',
  'moonrise',
  'confetti',
]

describe('resolveMotion (full motion)', () => {
  it('peel is a 420 ms timing with the overshoot curve', () => {
    expect(resolveMotion('peel', false)).toEqual({
      kind: 'timing',
      duration: 420,
      easing: [0.34, 1.56, 0.64, 1],
      loop: false,
    })
  })

  it('float is a 3.2 s loop', () => {
    expect(resolveMotion('float', false)).toMatchObject({
      kind: 'loop',
      duration: 3200,
      easing: [0.45, 0, 0.55, 1],
      loop: true,
    })
  })

  it('twinkle is a 1.6 s loop', () => {
    expect(resolveMotion('twinkle', false)).toMatchObject({
      kind: 'loop',
      duration: 1600,
      loop: true,
    })
  })

  it('pawTrail takes 120 ms per print', () => {
    expect(resolveMotion('pawTrail', false)).toMatchObject({
      kind: 'timing',
      duration: 120,
      loop: false,
    })
  })

  it('moonrise is a 360 ms step transition on the standard curve', () => {
    expect(resolveMotion('moonrise', false)).toEqual({
      kind: 'timing',
      duration: 360,
      easing: [0.2, 0.8, 0.2, 1],
      loop: false,
    })
  })

  it('confetti is a 900 ms burst', () => {
    expect(resolveMotion('confetti', false)).toEqual({
      kind: 'timing',
      duration: 900,
      easing: [0.16, 1, 0.3, 1],
      loop: false,
    })
  })

  it('takes its durations and curves from the generated motion tokens', () => {
    expect(resolveMotion('peel', false).duration).toBe(motion.duration.gentle)
    expect(resolveMotion('peel', false).easing).toEqual(motion.easing.peel)
    expect(resolveMotion('float', false).duration).toBe(motion.duration.floatLoop)
    expect(resolveMotion('twinkle', false).duration).toBe(motion.duration.twinkle)
    expect(resolveMotion('pawTrail', false).duration).toBe(motion.stagger.trail)
    expect(resolveMotion('confetti', false).duration).toBe(motion.duration.burst)
  })
})

describe('resolveMotion (Reduce Motion)', () => {
  it('stops the float loop', () => {
    expect(resolveMotion('float', true)).toMatchObject({ kind: 'none', loop: false })
  })

  it('stops the twinkle loop', () => {
    expect(resolveMotion('twinkle', true)).toMatchObject({ kind: 'none', loop: false })
  })

  it('turns the peel entrance into a 160 ms fade', () => {
    expect(resolveMotion('peel', true)).toEqual({
      kind: 'fade',
      duration: 160,
      easing: [0.2, 0.8, 0.2, 1],
      loop: false,
    })
  })

  it('turns the paw trail and moonrise entrances into 160 ms fades', () => {
    for (const preset of ['pawTrail', 'moonrise'] as const) {
      expect(resolveMotion(preset, true)).toEqual({
        kind: 'fade',
        duration: 160,
        easing: [0.2, 0.8, 0.2, 1],
        loop: false,
      })
    }
  })

  it('drops the confetti burst', () => {
    expect(resolveMotion('confetti', true)).toMatchObject({ kind: 'none' })
  })

  it('never loops and never runs longer than 160 ms', () => {
    for (const preset of presets) {
      const spec = resolveMotion(preset, true)
      expect(spec.loop).toBe(false)
      expect(spec.kind === 'timing' || spec.kind === 'loop').toBe(false)
      expect(spec.duration).toBeLessThanOrEqual(160)
    }
  })

  it('gives a motionless result zero duration', () => {
    expect(resolveMotion('float', true).duration).toBe(0)
  })
})
