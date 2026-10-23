import type { ReactNode } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { CENTERED_MAX_WIDTH, useLayoutMode } from './layoutMode'

/** Full width on a phone; a centred column at most 560 px wide from 768 px up. */
export function ContentColumn({
  children,
  style,
}: {
  children?: ReactNode
  style?: StyleProp<ViewStyle>
}) {
  const mode = useLayoutMode()

  return (
    <View
      testID="content-column"
      style={[styles.column, mode === 'mobile' ? null : styles.capped, style]}
    >
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  column: { width: '100%', alignSelf: 'center' },
  capped: { maxWidth: CENTERED_MAX_WIDTH },
})
