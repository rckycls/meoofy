import type { TextStyle } from 'react-native'

import type { TextStyleToken } from './type'

export type TokenTextStyle = Pick<TextStyle, 'fontFamily' | 'fontSize' | 'lineHeight'>

/**
 * Turns a `type.*` token into a text style.
 *
 * The token is mapped field by field instead of being spread: its `weight`
 * only selects the per-weight Inter family and must never reach the style as
 * `fontWeight`, or web and Android would synthesise a second bold.
 */
export function textStyle(token: TextStyleToken): TokenTextStyle {
  return {
    fontFamily: token.fontFamily,
    fontSize: token.fontSize,
    lineHeight: token.lineHeight,
  }
}
