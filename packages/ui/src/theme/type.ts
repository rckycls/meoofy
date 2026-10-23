// Inter type scale. Each weight is its own font file, registered under the
// family name Inter_<weight> (Inter_400, Inter_500, Inter_600, Inter_700).

export type FontWeight = '400' | '500' | '600' | '700'

export const fontFamily = {
  '400': 'Inter_400',
  '500': 'Inter_500',
  '600': 'Inter_600',
  '700': 'Inter_700',
} as const satisfies Record<FontWeight, string>

export type TextStyleToken = {
  fontFamily: (typeof fontFamily)[FontWeight]
  fontSize: number
  lineHeight: number
  /**
   * The Inter weight baked into `fontFamily`. It is deliberately not named
   * `fontWeight`: setting that on top of a per-weight font makes web and
   * Android synthesise a second bold.
   */
  weight: FontWeight
}

function style(weight: FontWeight, fontSize: number, lineHeight: number): TextStyleToken {
  return { fontFamily: fontFamily[weight], fontSize, lineHeight, weight }
}

export const type = {
  headline: style('700', 28, 39),
  section: style('600', 22, 28),
  cardTitle: style('600', 17, 22),
  noteTitle: style('600', 15, 20),
  body: style('400', 14, 20),
  small: style('400', 13, 18),
  caption: style('400', 12, 16),
} as const satisfies Record<string, TextStyleToken>

export type TypeRole = keyof typeof type
