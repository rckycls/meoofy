import { act, render, screen } from '@testing-library/react-native'
import { AccessibilityInfo, StyleSheet, Text } from 'react-native'
import { getAnimatedStyle, useReducedMotion } from 'react-native-reanimated'

import * as ui from '../index'
import { Confetti } from './Confetti'
import { Float } from './Float'
import { Peel } from './Peel'
import { Twinkle } from './Twinkle'
import { useMotionPreference } from './useMotionPreference'

// Reanimated reads the system setting once at start-up, so the tests replace
// the hook and flip it per test. Everything else in Reanimated stays real.
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated')
  return { ...actual, useReducedMotion: jest.fn(() => false) }
})

const mockReduced = jest.mocked(useReducedMotion)

function flat(element: { props: { style?: unknown } }) {
  return StyleSheet.flatten(element.props.style as never) ?? {}
}

beforeEach(() => {
  mockReduced.mockReturnValue(false)
})

describe('useMotionPreference', () => {
  function Probe() {
    const { reduced } = useMotionPreference()
    return <Text testID="probe">{reduced ? 'reduced' : 'full'}</Text>
  }

  it('reports full motion when the system setting is off', async () => {
    await render(<Probe />)
    expect(screen.getByTestId('probe')).toHaveTextContent('full')
  })

  it('reports reduced motion when Reanimated says the system setting is on', async () => {
    mockReduced.mockReturnValue(true)
    await render(<Probe />)
    expect(screen.getByTestId('probe')).toHaveTextContent('reduced')
  })

  it('follows the system setting when it changes while the app is open', async () => {
    let listener: ((value: boolean) => void) | undefined
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementationOnce((name, handler) => {
      if (name === 'reduceMotionChanged') listener = handler as (value: boolean) => void
      return { remove: jest.fn() }
    })
    await render(<Probe />)
    expect(screen.getByTestId('probe')).toHaveTextContent('full')

    await act(async () => {
      listener?.(true)
    })
    expect(screen.getByTestId('probe')).toHaveTextContent('reduced')

    await act(async () => {
      listener?.(false)
    })
    expect(screen.getByTestId('probe')).toHaveTextContent('full')
  })

  it('picks up a setting that was already on when the screen mounted', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValueOnce(true)
    await render(<Probe />)
    expect(await screen.findByText('reduced')).toBeOnTheScreen()
  })

  it('removes its listener on unmount', async () => {
    const remove = jest.fn()
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValueOnce({ remove })
    const view = await render(<Probe />)
    await view.unmount()
    expect(remove).toHaveBeenCalledTimes(1)
  })
})

describe('Float', () => {
  it('floats its children with an animated transform', async () => {
    await render(
      <Float index={0}>
        <Text>Sticker</Text>
      </Float>,
    )

    const frame = screen.getByTestId('float')
    expect(screen.getByText('Sticker')).toBeOnTheScreen()
    expect(flat(frame).transform).toBeDefined()
  })

  it('renders its children statically when Reduce Motion is on', async () => {
    mockReduced.mockReturnValue(true)
    await render(
      <Float index={3}>
        <Text>Sticker</Text>
      </Float>,
    )

    const frame = screen.getByTestId('float')
    expect(screen.getByText('Sticker')).toBeOnTheScreen()
    expect(flat(frame).transform).toBeUndefined()
    expect(flat(frame).opacity).toBeUndefined()
  })
})

describe('Twinkle', () => {
  it('twinkles with an animated opacity and scale', async () => {
    await render(
      <Twinkle>
        <Text>Sparkle</Text>
      </Twinkle>,
    )

    const frame = screen.getByTestId('twinkle')
    expect(screen.getByText('Sparkle')).toBeOnTheScreen()
    expect(flat(frame).transform).toBeDefined()
  })

  it('holds still under Reduce Motion', async () => {
    mockReduced.mockReturnValue(true)
    await render(
      <Twinkle>
        <Text>Sparkle</Text>
      </Twinkle>,
    )

    const frame = screen.getByTestId('twinkle')
    expect(screen.getByText('Sparkle')).toBeOnTheScreen()
    expect(flat(frame).transform).toBeUndefined()
    expect(flat(frame).opacity).toBeUndefined()
  })
})

describe('Peel', () => {
  it('peels in with a transform and starts transparent', async () => {
    await render(
      <Peel>
        <Text>Hello</Text>
      </Peel>,
    )

    const frame = screen.getByTestId('peel')
    expect(screen.getByText('Hello')).toBeOnTheScreen()
    expect(flat(frame).transform).toBeDefined()
    expect(flat(frame).opacity).toBe(0)
  })

  it('only fades under Reduce Motion', async () => {
    mockReduced.mockReturnValue(true)
    await render(
      <Peel delay={200}>
        <Text>Hello</Text>
      </Peel>,
    )

    const frame = screen.getByTestId('peel')
    expect(screen.getByText('Hello')).toBeOnTheScreen()
    // No movement: the transform is pinned at rest.
    expect(flat(frame).transform).toEqual([{ scale: 1 }, { rotate: '0deg' }])
    expect(flat(frame).opacity).toBe(0)
  })
})

describe('Confetti', () => {
  // The burst is decoration, so the whole layer is hidden from assistive tech
  // and the queries have to include hidden elements.
  const hidden = { includeHiddenElements: true } as const

  it('renders nothing while inactive', async () => {
    await render(<Confetti active={false} />)
    expect(screen.queryByTestId('confetti', hidden)).not.toBeOnTheScreen()
  })

  it('bursts pieces when active', async () => {
    await render(<Confetti active />)
    expect(screen.getByTestId('confetti', hidden)).toBeOnTheScreen()
    expect(screen.getAllByTestId('confetti-piece', hidden).length).toBeGreaterThanOrEqual(12)
  })

  it('starts every piece invisible so nothing flashes before the burst', async () => {
    await render(<Confetti active />)
    for (const piece of screen.getAllByTestId('confetti-piece', hidden)) {
      expect(flat(piece).opacity).toBe(0)
    }
  })

  it('is decorative: hidden from assistive tech and ignores touches', async () => {
    await render(<Confetti active />)
    const layer = screen.getByTestId('confetti', hidden)
    expect(layer.props.accessibilityElementsHidden).toBe(true)
    expect(layer.props.importantForAccessibility).toBe('no-hide-descendants')
    expect(flat(layer).pointerEvents).toBe('none')
  })

  it('fills its parent so the burst can start from the centre', async () => {
    await render(<Confetti active />)
    expect(flat(screen.getByTestId('confetti', hidden))).toMatchObject({
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    })
  })

  it('draws nothing under Reduce Motion', async () => {
    mockReduced.mockReturnValue(true)
    await render(<Confetti active />)
    expect(screen.queryByTestId('confetti', hidden)).not.toBeOnTheScreen()
  })
})

// Reanimated applies its frames outside the style prop, so these tests read
// the live style it reports and move the clock by hand.
describe('motion over time', () => {
  type Frame = {
    opacity?: number
    translateY?: number
    scale?: number
    rotate?: number
    hasTransform: boolean
  }

  // The package types resolve to Reanimated's web stub, which takes no
  // arguments. Under Jest the real implementation is loaded.
  const readAnimatedStyle = getAnimatedStyle as unknown as (element: unknown) => {
    opacity?: number
    transform?: Record<string, number | string>[]
  }

  function frameOf(element: unknown): Frame {
    const style = readAnimatedStyle(element)
    const part = (key: string) => style.transform?.find((entry) => key in entry)?.[key]
    const rotate = part('rotate')
    return {
      opacity: style.opacity,
      translateY: part('translateY') as number | undefined,
      scale: part('scale') as number | undefined,
      rotate: typeof rotate === 'string' ? parseFloat(rotate) : undefined,
      hasTransform: style.transform !== undefined,
    }
  }

  async function advance(ms: number) {
    await act(async () => {
      jest.advanceTimersByTime(ms)
    })
  }

  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('Peel', () => {
    it('peels in over 420 ms, overshooting before it settles', async () => {
      await render(
        <Peel>
          <Text>Hello</Text>
        </Peel>,
      )
      const peel = screen.getByTestId('peel')

      expect(frameOf(peel)).toMatchObject({ opacity: 0, scale: 0.6, rotate: -8 })

      await advance(200)
      const mid = frameOf(peel)
      expect(mid.opacity).toBe(1)
      // The curve overshoots 1, so the sticker is briefly bigger than rest.
      expect(mid.scale).toBeGreaterThan(1)

      await advance(300)
      expect(frameOf(peel)).toMatchObject({ opacity: 1, scale: 1, rotate: 0 })
    })

    it('waits for its delay before starting', async () => {
      await render(
        <Peel delay={300}>
          <Text>Hello</Text>
        </Peel>,
      )
      const peel = screen.getByTestId('peel')

      await advance(250)
      expect(frameOf(peel)).toMatchObject({ opacity: 0, scale: 0.6 })

      await advance(600)
      expect(frameOf(peel)).toMatchObject({ opacity: 1, scale: 1 })
    })

    it('fades in over 160 ms with no movement under Reduce Motion', async () => {
      mockReduced.mockReturnValue(true)
      await render(
        <Peel>
          <Text>Hello</Text>
        </Peel>,
      )
      const peel = screen.getByTestId('peel')
      expect(frameOf(peel)).toMatchObject({ opacity: 0, scale: 1, rotate: 0 })

      await advance(80)
      const mid = frameOf(peel)
      expect(mid.opacity).toBeGreaterThan(0)
      expect(mid.opacity).toBeLessThan(1)
      expect(mid).toMatchObject({ scale: 1, rotate: 0 })

      await advance(100)
      expect(frameOf(peel)).toMatchObject({ opacity: 1, scale: 1, rotate: 0 })
    })

    it('does not replay when Reduce Motion is switched on after it has settled', async () => {
      const view = await render(
        <Peel>
          <Text>Hello</Text>
        </Peel>,
      )
      await advance(600)
      expect(frameOf(screen.getByTestId('peel'))).toMatchObject({ opacity: 1, scale: 1 })

      mockReduced.mockReturnValue(true)
      await view.rerender(
        <Peel>
          <Text>Hello</Text>
        </Peel>,
      )
      await advance(50)

      expect(frameOf(screen.getByTestId('peel'))).toMatchObject({ opacity: 1, scale: 1, rotate: 0 })
    })
    it('stops tilting at once when Reduce Motion is switched on mid-peel', async () => {
      const view = await render(
        <Peel>
          <Text>Hello</Text>
        </Peel>,
      )
      await advance(40)
      expect(frameOf(screen.getByTestId('peel')).scale).not.toBe(1)

      mockReduced.mockReturnValue(true)
      await view.rerender(
        <Peel>
          <Text>Hello</Text>
        </Peel>,
      )
      await advance(300)

      expect(frameOf(screen.getByTestId('peel'))).toMatchObject({ opacity: 1, scale: 1, rotate: 0 })
    })
  })

  describe('Float', () => {
    it('rises 10 px and tilts 2 degrees, then returns, over 3.2 s', async () => {
      await render(
        <Float index={0}>
          <Text>Sticker</Text>
        </Float>,
      )
      const float = screen.getByTestId('float')
      expect(frameOf(float)).toMatchObject({ translateY: 0, rotate: -2 })

      await advance(1600)
      const top = frameOf(float)
      expect(top.translateY).toBeCloseTo(-10, 0)
      expect(top.rotate).toBeCloseTo(2, 0)

      await advance(1600)
      const rest = frameOf(float)
      expect(rest.translateY).toBeCloseTo(0, 0)
      expect(rest.rotate).toBeCloseTo(-2, 0)
    })

    it('stands still when Reduce Motion is switched on while it floats', async () => {
      const view = await render(
        <Float index={0}>
          <Text>Sticker</Text>
        </Float>,
      )
      await advance(800)
      expect(frameOf(screen.getByTestId('float')).translateY).toBeLessThan(-1)

      mockReduced.mockReturnValue(true)
      await view.rerender(
        <Float index={0}>
          <Text>Sticker</Text>
        </Float>,
      )

      expect(screen.getByText('Sticker')).toBeOnTheScreen()
      expect(flat(screen.getByTestId('float')).transform).toBeUndefined()
    })

    it('keeps looping', async () => {
      await render(
        <Float index={0}>
          <Text>Sticker</Text>
        </Float>,
      )
      await advance(3200 + 1600)
      expect(frameOf(screen.getByTestId('float')).translateY).toBeCloseTo(-10, 0)
    })

    it('starts index x 400 ms late', async () => {
      await render(
        <>
          <Float index={0}>
            <Text>First</Text>
          </Float>
          <Float index={3}>
            <Text>Fourth</Text>
          </Float>
        </>,
      )
      const [first, fourth] = screen.getAllByTestId('float')

      await advance(1000)
      expect(frameOf(first).translateY).toBeLessThan(-1)
      // 3 x 400 = 1200 ms of waiting.
      expect(frameOf(fourth).translateY).toBe(0)

      await advance(400)
      expect(frameOf(fourth).translateY).toBeLessThan(0)
    })
  })

  describe('Twinkle', () => {
    it('dims and shrinks, then returns, over 1.6 s', async () => {
      await render(
        <Twinkle>
          <Text>Sparkle</Text>
        </Twinkle>,
      )
      const twinkle = screen.getByTestId('twinkle')
      expect(frameOf(twinkle)).toMatchObject({ opacity: 1, scale: 1 })

      await advance(800)
      const dim = frameOf(twinkle)
      expect(dim.opacity).toBeCloseTo(0.45, 1)
      expect(dim.scale).toBeCloseTo(0.85, 1)

      await advance(800)
      const back = frameOf(twinkle)
      expect(back.opacity).toBeCloseTo(1, 1)
      expect(back.scale).toBeCloseTo(1, 1)
    })
  })

  describe('Confetti', () => {
    it('bursts out and fades away within 900 ms', async () => {
      await render(<Confetti active />)
      const pieces = screen.getAllByTestId('confetti-piece', { includeHiddenElements: true })

      await advance(300)
      const mid = pieces.map(frameOf)
      expect(mid.every((piece) => piece.opacity === 1)).toBe(true)
      expect(mid.some((piece) => piece.hasTransform)).toBe(true)

      await advance(700)
      expect(pieces.map(frameOf).every((piece) => piece.opacity === 0)).toBe(true)
    })
  })
})

describe('package entry', () => {
  it('re-exports the motion API', () => {
    expect(ui.Peel).toBe(Peel)
    expect(ui.Float).toBe(Float)
    expect(ui.Twinkle).toBe(Twinkle)
    expect(ui.Confetti).toBe(Confetti)
    expect(ui.useMotionPreference).toBe(useMotionPreference)
    expect(typeof ui.resolveMotion).toBe('function')
  })
})
