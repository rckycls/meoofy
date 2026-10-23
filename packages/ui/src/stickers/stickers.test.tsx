// The package's tsconfig only loads the jest types. This test reads the
// exported SVGs from disk, so it pulls in the Node types for itself.
/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { render, screen } from '@testing-library/react-native'
import { StyleSheet, processColor } from 'react-native'

import * as ui from '../index'
import { cardRoles, flowTints, type Flow } from '../theme/roles'
import { PetPortrait } from './PetPortrait'
import { Sticker } from './Sticker'
import { STICKER_NAMES, type StickerName } from './names'

// Stickers are hidden from assistive tech on purpose, so every query for one
// has to include hidden elements.
const hidden = { includeHiddenElements: true } as const

const ASSET_DIR = join(__dirname, '..', '..', 'assets', 'stickers')
const GENERATED_DIR = join(__dirname, 'generated')

describe('STICKER_NAMES', () => {
  it('lists the 14 stickers from board 09 in order', () => {
    expect(STICKER_NAMES).toEqual([
      'dog',
      'cat',
      'sleepy-moon',
      'cloud',
      'paw-star',
      'sparkle',
      'heart-paw',
      'paw-pin',
      'privacy-shield',
      'love-letter',
      'pet-tag',
      'shooting-star',
      'rainbow',
      'bone',
    ])
  })

  it('has one exported SVG per name, nothing more', () => {
    const files = readdirSync(ASSET_DIR).filter((file) => file.endsWith('.svg'))

    expect([...files].sort()).toEqual(STICKER_NAMES.map((name) => `${name}.svg`).sort())
  })

  it.each(STICKER_NAMES)('draws the %s shadow as an offset copy under the outline', (name) => {
    const svg = readFileSync(join(ASSET_DIR, `${name}.svg`), 'utf8')
    const paths = svg.match(/<path [^>]*\/>/g) ?? []
    const [shadow = '', outline = ''] = paths

    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('viewBox="0 0 120 120"')
    expect(shadow).toContain('fill="#53749A"')
    expect(shadow).toContain('fill-opacity="0.18"')
    expect(shadow).toContain('transform="translate(0 6)"')
    // The shadow is the outline's geometry, moved down; the outline stays white.
    expect(shadow.match(/ d="([^"]*)"/)?.[1]).toBe(outline.match(/ d="([^"]*)"/)?.[1])
    expect(outline).toContain('fill="#FFFFFF"')
    expect(outline).toContain('stroke="#FFFFFF"')
    expect(outline).not.toContain('transform=')
    // The shadow keeps the outline's stroke, tinted. Without it the offset
    // silhouette would sit wholly inside the white border and never show.
    expect(shadow).toContain('stroke="#53749A"')
    expect(shadow).toContain('stroke-opacity="0.18"')
    expect(shadow.match(/stroke-width="([^"]*)"/)?.[1]).toBe(
      outline.match(/stroke-width="([^"]*)"/)?.[1],
    )
  })

  it.each(STICKER_NAMES)('has the %s component generated from that SVG', (name) => {
    const component = name
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('')
    const source = readFileSync(join(GENERATED_DIR, `${component}.tsx`), 'utf8')

    expect(source).toContain('react-native-svg')
    expect(source).toContain('fillOpacity={0.18}')
    expect(source).toContain(`export default Svg${component}`)
  })
})

describe('Sticker', () => {
  it.each(STICKER_NAMES)('renders the %s sticker', async (name) => {
    await render(<Sticker name={name} />)

    expect(screen.getByTestId(`sticker-${name}`, hidden)).toBeOnTheScreen()
  })

  it('draws the artwork at the requested size, 64 by default', async () => {
    const { unmount } = await render(<Sticker name="dog" />)

    expect(screen.getByTestId('sticker-dog', hidden)).toHaveStyle({ width: 64, height: 64 })
    expect(screen.getByTestId('sticker-dog-art', hidden).props).toMatchObject({
      width: 64,
      height: 64,
    })
    await unmount()

    await render(<Sticker name="dog" size={96} />)
    expect(screen.getByTestId('sticker-dog', hidden)).toHaveStyle({ width: 96, height: 96 })
    expect(screen.getByTestId('sticker-dog-art', hidden).props).toMatchObject({
      width: 96,
      height: 96,
    })
  })

  it('is hidden from assistive technology', async () => {
    await render(<Sticker name="privacy-shield" />)

    const sticker = screen.getByTestId('sticker-privacy-shield', hidden)
    expect(sticker.props.accessibilityElementsHidden).toBe(true)
    expect(sticker.props.importantForAccessibility).toBe('no-hide-descendants')
    expect(sticker.props['aria-hidden']).toBe(true)
    expect(screen.queryByTestId('sticker-privacy-shield')).toBeNull()
  })

  it('rotates by the given degrees', async () => {
    await render(<Sticker name="cloud" rotate={-8} />)

    expect(screen.getByTestId('sticker-cloud', hidden)).toHaveStyle({
      transform: [{ rotate: '-8deg' }],
    })
  })

  it('does not rotate by default', async () => {
    await render(<Sticker name="cloud" />)

    const style = StyleSheet.flatten(screen.getByTestId('sticker-cloud', hidden).props.style)
    expect(style.transform).toBeUndefined()
  })
})

describe('PetPortrait', () => {
  it('shows the label and a cat sticker for a cat', async () => {
    await render(
      <PetPortrait species="cat" flow="owner" width={160} height={200} label="Luna photo" />,
    )

    expect(screen.getByText('Luna photo')).toBeOnTheScreen()
    expect(screen.getByTestId('sticker-cat', hidden)).toBeOnTheScreen()
    expect(screen.queryByTestId('sticker-dog', hidden)).toBeNull()
  })

  it('shows a dog sticker for a dog', async () => {
    await render(<PetPortrait species="dog" flow="owner" width={160} height={200} />)

    expect(screen.getByTestId('sticker-dog', hidden)).toBeOnTheScreen()
    expect(screen.queryByTestId('sticker-cat', hidden)).toBeNull()
  })

  it('adds one sparkle', async () => {
    await render(<PetPortrait species="dog" flow="owner" width={160} height={200} />)

    expect(screen.getAllByTestId('sticker-sparkle', hidden)).toHaveLength(1)
  })

  it('leaves out the label pill when there is no label', async () => {
    await render(<PetPortrait species="dog" flow="owner" width={160} height={200} />)

    expect(screen.queryByTestId('portrait-label', hidden)).toBeNull()
  })

  it('sizes the sticker at 0.6 of the height, 0.72 below 160', async () => {
    const heights: [number, number][] = [
      [200, 0.6],
      [160, 0.6],
      [159, 0.72],
      [120, 0.72],
    ]

    for (const [height, ratio] of heights) {
      const { unmount } = await render(
        <PetPortrait species="dog" flow="owner" width={160} height={height} />,
      )
      const style = StyleSheet.flatten(screen.getByTestId('sticker-dog', hidden).props.style)

      expect(style.width).toBeCloseTo(height * ratio, 5)
      expect(style.height).toBeCloseTo(height * ratio, 5)
      await unmount()
    }
  })

  it('fills the requested box', async () => {
    await render(<PetPortrait species="cat" flow="finder" width={120} height={140} />)

    expect(screen.getByTestId('pet-portrait', hidden)).toHaveStyle({ width: 120, height: 140 })
  })

  it.each(Object.keys(flowTints) as Flow[])(
    'paints a diagonal gradient from the %s flow glows',
    async (flow) => {
      await render(<PetPortrait species="dog" flow={flow} width={160} height={200} />)

      const gradient = screen.getByTestId('portrait-gradient', hidden)
      expect(gradient.props.colors).toEqual([
        processColor(flowTints[flow].glowA),
        processColor(flowTints[flow].glowB),
      ])
      expect(gradient.props.startPoint).toEqual([0, 0])
      expect(gradient.props.endPoint).toEqual([1, 1])
    },
  )

  it('sets a white halo behind the sticker', async () => {
    await render(<PetPortrait species="dog" flow="owner" width={160} height={200} />)

    const halo = StyleSheet.flatten(screen.getByTestId('portrait-halo', hidden).props.style)
    const sticker = StyleSheet.flatten(screen.getByTestId('sticker-dog', hidden).props.style)
    expect(halo.borderRadius).toBeGreaterThan(0)
    expect(halo.width).toBeGreaterThan(sticker.width as number)
    expect(processColor(halo.backgroundColor as string)).toEqual(
      processColor('rgba(255, 255, 255, 0.6)'),
    )
  })

  it('sets the label in the plain card role pair, from the type scale', async () => {
    await render(
      <PetPortrait species="cat" flow="owner" width={160} height={200} label="Luna photo" />,
    )

    const pill = StyleSheet.flatten(screen.getByTestId('portrait-label', hidden).props.style)
    expect(pill.backgroundColor).toBe(cardRoles.plain.from)
    const text = StyleSheet.flatten(screen.getByText('Luna photo').props.style)
    expect(text.color).toBe(cardRoles.plain.title)
    expect(text.fontFamily).toBe('Inter_400')
    expect(text).not.toHaveProperty('fontWeight')
  })

  it('hides nothing but the artwork from assistive technology', async () => {
    await render(
      <PetPortrait species="cat" flow="owner" width={160} height={200} label="Luna photo" />,
    )

    // The label stays reachable while every sticker in the portrait is hidden.
    expect(screen.getByText('Luna photo')).toBeOnTheScreen()
    expect(screen.queryByTestId('sticker-cat')).toBeNull()
    expect(screen.queryByTestId('sticker-sparkle')).toBeNull()
  })
})

describe('package entry', () => {
  it('re-exports the stickers and the portrait', () => {
    expect(ui.Sticker).toBe(Sticker)
    expect(ui.PetPortrait).toBe(PetPortrait)
    expect(ui.STICKER_NAMES).toBe(STICKER_NAMES)

    const name: ui.StickerName = 'bone' satisfies StickerName
    const species: ui.PetSpecies = 'cat'
    expect([name, species]).toEqual(['bone', 'cat'])
  })
})
