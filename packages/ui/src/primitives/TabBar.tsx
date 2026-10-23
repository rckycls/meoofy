import { Pressable, StyleSheet, Text, View } from 'react-native'

import { colors } from '../theme/tokens'
import { textStyle } from '../theme/textStyle'
import { type } from '../theme/type'
import { navItems, type NavProps } from './navItems'
import { useInsets } from './safeArea'

export function TabBar({ active, onSelect }: NavProps) {
  const insets = useInsets()

  return (
    <View
      testID="tab-bar"
      accessibilityRole="tablist"
      style={[
        styles.bar,
        { paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right },
      ]}
    >
      {navItems.map(({ key, label }) => {
        const selected = key === active
        return (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            onPress={() => onSelect?.(key)}
            style={styles.tab}
          >
            <View aria-hidden style={[styles.indicator, selected ? styles.indicatorOn : null]} />
            <Text style={[styles.label, { color: selected ? colors.cobalt : colors.slate }]}>
              {label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  tab: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  // The bar above the label marks the selected tab without relying on colour.
  indicator: { width: 24, height: 4, borderRadius: 2 },
  indicatorOn: { backgroundColor: colors.cobalt },
  label: textStyle(type.small),
})
