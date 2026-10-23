import { Pressable, StyleSheet, Text, View } from 'react-native'

import { colors, space } from '../theme/tokens'
import { textStyle } from '../theme/textStyle'
import { type } from '../theme/type'

export type CheckboxProps = {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}

export function Checkbox({ checked, onChange, label }: CheckboxProps) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      style={styles.row}
    >
      <View aria-hidden style={[styles.box, checked ? styles.boxChecked : styles.boxUnchecked]}>
        {checked ? <View style={styles.tick} /> : null}
      </View>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  )
}

const BOX = 24

const styles = StyleSheet.create({
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[16],
  },
  box: {
    width: BOX,
    height: BOX,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: { backgroundColor: colors.cobalt, borderColor: colors.cobalt },
  boxUnchecked: { backgroundColor: colors.white, borderColor: colors.slate },
  // A rotated L: the right and bottom edges of a small box make the tick.
  tick: {
    width: 7,
    height: 12,
    marginTop: -2,
    borderRightWidth: 2.5,
    borderBottomWidth: 2.5,
    borderColor: colors.white,
    transform: [{ rotate: '45deg' }],
  },
  label: { ...textStyle(type.body), flex: 1, color: colors.deepBlue },
})
