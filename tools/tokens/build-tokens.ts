// Reads the flattened Figma variable export (figma-tokens.json) and writes the
// design tokens module used by @meoofy/ui. Run with `pnpm gen:tokens`.
//
// Only erasable TypeScript syntax is used so Node can run this file directly.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { format, resolveConfig } from 'prettier'

const SOURCE = fileURLToPath(new URL('./figma-tokens.json', import.meta.url))
const TARGET = fileURLToPath(new URL('../../packages/ui/src/theme/tokens.ts', import.meta.url))

// Corner radii are not Figma variables. They come from the design spec
// (cards 24, fields 12, buttons 16) and are emitted next to the other tokens.
const RADII = { card: 24, button: 16, field: 12, chip: 16 } as const

// The export names every Color/* entry after a hue that no longer matches its
// value, so only these two are used and given role-based names.
const COLOR_ALIASES: Record<string, string> = {
  'Color/Line': 'line',
  'Color/Mint': 'skyTint',
}

type Dimension = { value: number; unit: string }
type Bezier = [number, number, number, number]

function fail(message: string): never {
  throw new Error(`build-tokens: ${message}`)
}

/** "Deep Blue" -> "deepBlue", "Float loop" -> "floatLoop". */
function camelCase(label: string): string {
  const words = label.trim().split(/\s+/)
  return words
    .map((word, i) =>
      i === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join('')
}

function asHex(name: string, value: unknown): string {
  if (typeof value !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(value)) {
    return fail(`${name} must be a #RRGGBB colour, got ${JSON.stringify(value)}`)
  }
  return value.toUpperCase()
}

function asDimension(name: string, value: unknown): Dimension {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as Dimension).value !== 'number' ||
    typeof (value as Dimension).unit !== 'string'
  ) {
    return fail(`${name} must be { value: number, unit: string }, got ${JSON.stringify(value)}`)
  }
  return value as Dimension
}

function asBezier(name: string, value: unknown): Bezier {
  const match = typeof value === 'string' ? /^cubic-bezier\(([^)]*)\)$/.exec(value.trim()) : null
  const parts = match?.[1]?.split(',').map((part) => Number(part.trim())) ?? []
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return fail(`${name} must be cubic-bezier(a, b, c, d), got ${JSON.stringify(value)}`)
  }
  return parts as Bezier
}

function byValue(a: [string, number], b: [string, number]): number {
  return a[1] - b[1]
}

export function buildTokens(raw: Record<string, unknown>) {
  const colors: Record<string, string> = {}
  const space: Record<string, number> = {}
  const duration: [string, number][] = []
  const stagger: [string, number][] = []
  const easing: [string, Bezier][] = []
  const motionScalars: Record<string, number> = {}

  const setColor = (key: string, name: string, value: unknown) => {
    if (key in colors) fail(`duplicate colour name "${key}" (from ${name})`)
    colors[key] = asHex(name, value)
  }

  for (const [name, value] of Object.entries(raw)) {
    const [group, ...rest] = name.split('/')
    const leaf = rest.join('/')

    if (group === 'Palette') {
      setColor(camelCase(leaf), name, value)
    } else if (group === 'Color') {
      // Most Color/* names no longer match their values, so they are skipped.
      // COLOR_ALIASES below picks the two that are tokens.
    } else if (group === 'Space') {
      const dim = asDimension(name, value)
      if (!/^\d+$/.test(leaf)) fail(`${name} must end in a whole number step`)
      if (dim.unit !== 'px') fail(`${name} must be in px, got ${dim.unit}`)
      space[leaf] = dim.value
    } else if (group === 'Motion') {
      // The export tags Motion values with unit "px" but they are milliseconds
      // (durations, staggers), a pixel distance (float) or degrees (tilt).
      const [kind, ...labelParts] = rest
      const label = labelParts.join('/')
      if (kind === 'Duration') duration.push([camelCase(label), asDimension(name, value).value])
      else if (kind === 'Stagger') stagger.push([camelCase(label), asDimension(name, value).value])
      else if (kind === 'Easing') easing.push([camelCase(label), asBezier(name, value)])
      else if (kind === 'Distance' && label === 'Float')
        motionScalars.floatDistance = asDimension(name, value).value
      else if (kind === 'Tilt' && label === 'Max')
        motionScalars.tiltMax = asDimension(name, value).value
      else fail(`unrecognised motion token "${name}"`)
    } else {
      fail(`unrecognised token group in "${name}"`)
    }
  }

  for (const [figmaName, key] of Object.entries(COLOR_ALIASES)) {
    if (!(figmaName in raw)) fail(`missing required token "${figmaName}"`)
    setColor(key, figmaName, raw[figmaName])
  }
  for (const key of ['floatDistance', 'tiltMax']) {
    if (!(key in motionScalars)) fail(`missing motion token "${key}"`)
  }

  const spaceEntries = Object.entries(space).sort(([a], [b]) => Number(a) - Number(b))

  return {
    colors,
    space: Object.fromEntries(spaceEntries),
    motion: {
      duration: Object.fromEntries(duration.sort(byValue)),
      stagger: Object.fromEntries(stagger.sort(byValue)),
      easing: Object.fromEntries(easing),
      ...motionScalars,
    },
    radii: RADII,
  }
}

/** Object literal with unquoted numeric keys, so `keyof` yields numbers. */
function numericKeyed(value: Record<string, number>): string {
  return `{ ${Object.entries(value)
    .map(([key, n]) => `${key}: ${n}`)
    .join(', ')} }`
}

export function renderTokens(raw: Record<string, unknown>): string {
  const tokens = buildTokens(raw)
  const json = (value: unknown) => JSON.stringify(value, null, 2)
  return `// generated by tools/tokens/build-tokens.ts from tools/tokens/figma-tokens.json.
// Do not edit by hand. Run \`pnpm gen:tokens\` to regenerate.

/** Palette/* plus line and skyTint (from Color/Line and Color/Mint). */
export const colors = ${json(tokens.colors)} as const

export type ColorName = keyof typeof colors

/** Spacing in px, keyed by step: \`space[16]\`. */
export const space = ${numericKeyed(tokens.space)} as const

export type SpaceStep = keyof typeof space

/** Corner radii in px. */
export const radii = ${json(tokens.radii)} as const

/** A cubic-bezier curve as [x1, y1, x2, y2]. */
export type Bezier = readonly [number, number, number, number]

/**
 * Durations and staggers are milliseconds, \`floatDistance\` is px and
 * \`tiltMax\` is degrees. (Figma exports every Motion value with unit "px".)
 */
export const motion = ${json(tokens.motion)} as const
`
}

async function main() {
  const raw = JSON.parse(readFileSync(SOURCE, 'utf8')) as Record<string, unknown>
  const config = (await resolveConfig(TARGET)) ?? {}
  const source = await format(renderTokens(raw), { ...config, parser: 'typescript' })
  writeFileSync(TARGET, source)
  console.log(`wrote ${TARGET}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
