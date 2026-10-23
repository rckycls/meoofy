import * as ui from '../index'
import { cardRoles, flowTints, type CardRole, type Flow } from './roles'
import { colors, motion, radii, space } from './tokens'
import { fontFamily, type } from './type'

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [lighter = 0, darker = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

describe('tokens', () => {
  it('exposes the palette and the Color/Line alias', () => {
    expect(colors.cobalt).toBe('#2858C8')
    expect(colors.leaf).toBe('#1C7055')
    expect(colors.line).toBe('#D9E3F0')
  })

  it('reads motion values as milliseconds and easings as bezier tuples', () => {
    expect(motion.duration.gentle).toBe(420)
    expect(motion.easing.peel).toEqual([0.34, 1.56, 0.64, 1])
  })

  it('has every palette colour under its camelCase name', () => {
    expect(colors).toEqual({
      cloud: '#F8FBFF',
      sky: '#74C3FF',
      cobalt: '#2858C8',
      deepBlue: '#183B73',
      moonYellow: '#FFD95A',
      softYellow: '#FFF2AE',
      mistGray: '#E8EDF4',
      slate: '#465268',
      cocoa: '#896341',
      sand: '#D7B589',
      ink: '#1D2A3A',
      white: '#FFFFFF',
      lavender: '#E6E1FF',
      blush: '#FFB3C6',
      twilight: '#6E8FE8',
      mint: '#D9F5EA',
      leaf: '#1C7055',
      peach: '#FFE4CF',
      ember: '#A04E1C',
      petal: '#FFE3EC',
      rose: '#B03562',
      iris: '#5B4FC9',
      line: '#D9E3F0',
      skyTint: '#DCEEFF',
    })
  })

  it('keeps Palette/Mint and Color/Mint (skyTint) apart', () => {
    expect(colors.mint).toBe('#D9F5EA')
    expect(colors.skyTint).toBe('#DCEEFF')
  })

  it('has the spacing scale and the radii', () => {
    expect(space).toEqual({ 8: 8, 16: 16, 24: 24, 32: 32, 48: 48, 64: 64 })
    expect(radii).toEqual({ card: 24, button: 16, field: 12, chip: 16 })
  })

  it('has the full motion set', () => {
    expect(motion).toEqual({
      duration: {
        instant: 80,
        fast: 160,
        base: 240,
        gentle: 420,
        burst: 900,
        twinkle: 1600,
        floatLoop: 3200,
      },
      stagger: { trail: 120, float: 400 },
      easing: {
        standard: [0.2, 0.8, 0.2, 1],
        peel: [0.34, 1.56, 0.64, 1],
        float: [0.45, 0, 0.55, 1],
        burst: [0.16, 1, 0.3, 1],
        exit: [0.4, 0, 1, 1],
      },
      floatDistance: 10,
      tiltMax: 12,
    })
  })
})

describe('colour roles', () => {
  it('maps the tip card role', () => {
    expect(cardRoles.tip).toEqual({
      from: '#D9F5EA',
      to: '#EAFAF3',
      title: '#1C7055',
      body: '#2A6450',
    })
  })

  it('maps every card role', () => {
    expect(cardRoles).toEqual({
      privacy: { from: '#DCEEFF', to: '#E8F1FF', title: '#2858C8', body: '#2858C8' },
      tip: { from: '#D9F5EA', to: '#EAFAF3', title: '#1C7055', body: '#2A6450' },
      community: { from: '#E9E5FF', to: '#F3F0FF', title: '#5B4FC9', body: '#4B4396' },
      warning: { from: '#FFE4CF', to: '#FFF0E4', title: '#A04E1C', body: '#7E4019' },
      celebration: { from: '#FFE3EC', to: '#FFF1F5', title: '#B03562', body: '#7D3350' },
      attention: { from: '#FFF2AE', to: '#FFF8D6', title: '#7A5A00', body: '#6B5300' },
      plain: {
        from: '#FFFFFF',
        to: '#FFFFFF',
        title: '#183B73',
        body: '#465268',
        stroke: '#E9EEF6',
      },
    })
  })

  it('keeps title and body at AA contrast (4.5:1) on both gradient stops', () => {
    const failures: string[] = []
    for (const role of Object.keys(cardRoles) as CardRole[]) {
      const { from, to, title, body } = cardRoles[role]
      for (const [part, text] of [
        ['title', title],
        ['body', body],
      ] as const) {
        for (const background of [from, to]) {
          const ratio = contrast(text, background)
          if (ratio < 4.5) failures.push(`${role} ${part} ${text} on ${background}: ${ratio}`)
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('keeps every button label at AA contrast (4.5:1)', () => {
    // Primary, secondary, urgent, and disabled (see Button.tsx).
    const pairs = [
      [colors.white, colors.cobalt],
      [colors.deepBlue, colors.white],
      [colors.white, colors.deepBlue],
      [colors.deepBlue, colors.line],
    ] as const
    const failures = pairs.filter(([text, background]) => contrast(text, background) < 4.5)
    expect(failures).toEqual([])
  })

  it('maps the owner flow tint', () => {
    expect(flowTints.owner.tint).toBe('#E6F2FF')
  })

  it('maps every flow tint', () => {
    const expected: Record<Flow, { tint: string; glowA: string; glowB: string }> = {
      onboarding: { tint: '#E9F3FF', glowA: '#FFF2AE', glowB: '#E6E1FF' },
      owner: { tint: '#E6F2FF', glowA: '#FFF2AE', glowB: '#CFE6FF' },
      finder: { tint: '#E3F7EF', glowA: '#C9F0E0', glowB: '#DCEEFF' },
      recovery: { tint: '#FFEEF3', glowA: '#FFD3E0', glowB: '#E6E1FF' },
      outcomes: { tint: '#EFEBFF', glowA: '#DCD5FF', glowB: '#FFE1CC' },
      resilience: { tint: '#FFF1E6', glowA: '#FFE1C8', glowB: '#FFF2AE' },
    }
    expect(flowTints).toEqual(expected)
  })
})

describe('type scale', () => {
  it('exposes the headline style', () => {
    expect(type.headline).toMatchObject({ fontSize: 28, lineHeight: 39 })
  })

  it('has every size, line height and weight from the spec', () => {
    const scale = Object.fromEntries(
      Object.entries(type).map(([name, t]) => [name, [t.fontSize, t.lineHeight, t.weight]]),
    )
    expect(scale).toEqual({
      headline: [28, 39, '700'],
      section: [22, 28, '600'],
      cardTitle: [17, 22, '600'],
      noteTitle: [15, 20, '600'],
      body: [14, 20, '400'],
      small: [13, 18, '400'],
      caption: [12, 16, '400'],
    })
  })

  it('uses a per-weight Inter family and never sets fontWeight', () => {
    expect(type.headline.fontFamily).toBe('Inter_700')
    expect(type.body.fontFamily).toBe('Inter_400')
    expect(fontFamily).toEqual({
      '400': 'Inter_400',
      '500': 'Inter_500',
      '600': 'Inter_600',
      '700': 'Inter_700',
    })
    for (const t of Object.values(type)) expect(t).not.toHaveProperty('fontWeight')
  })
})

describe('package entry', () => {
  it('re-exports the theme', () => {
    expect(ui.colors).toBe(colors)
    expect(ui.cardRoles).toBe(cardRoles)
    expect(ui.flowTints).toBe(flowTints)
    expect(ui.type).toBe(type)
    expect(ui.motion).toBe(motion)
  })
})
