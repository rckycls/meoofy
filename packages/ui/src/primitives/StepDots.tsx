import { StyleSheet, View } from 'react-native'

import { colors, space } from '../theme/tokens'

export type StepDotsProps = {
  count: number
  /** Zero-based index of the current step. */
  current: number
}

const DOT = 8
const CURRENT_WIDTH = 20

export function StepDots({ count, current }: StepDotsProps) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${current + 1} of ${count}`}
      accessibilityValue={{ min: 1, max: count, now: current + 1 }}
      style={styles.row}
    >
      {Array.from({ length: count }, (_, index) => (
        <View
          key={index}
          testID={`step-dot-${index}`}
          style={[styles.dot, index === current ? styles.current : styles.other]}
        />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[8] },
  dot: { height: DOT, borderRadius: DOT / 2 },
  current: { width: CURRENT_WIDTH, backgroundColor: colors.cobalt },
  other: { width: DOT, backgroundColor: colors.sky },
})
