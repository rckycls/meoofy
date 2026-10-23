import { Pressable, StyleSheet, Text, View } from 'react-native'

import { colors, space } from '../theme/tokens'
import { textStyle } from '../theme/textStyle'
import { type } from '../theme/type'
import { navItems, type NavProps } from './navItems'

export function WebNav({ active, onSelect }: NavProps) {
  return (
    <View testID="web-nav" role="navigation" aria-label="Main" style={styles.bar}>
      <Text style={styles.brand}>PawPin</Text>
      <View style={styles.links}>
        {navItems.map(({ key, label }) => {
          const selected = key === active
          return (
            <Pressable
              key={key}
              accessibilityRole="link"
              accessibilityLabel={label}
              accessibilityState={{ selected }}
              onPress={() => onSelect?.(key)}
              style={[styles.link, selected ? styles.linkOn : null]}
            >
              <Text style={[styles.label, { color: selected ? colors.cobalt : colors.slate }]}>
                {label}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    minHeight: space[64],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[24],
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  brand: { ...textStyle(type.section), color: colors.deepBlue },
  links: { flexDirection: 'row', alignItems: 'center', gap: space[8] },
  link: {
    minHeight: 48,
    paddingHorizontal: space[16],
    justifyContent: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  // The underline marks the selected link without relying on colour.
  linkOn: { borderBottomColor: colors.cobalt },
  label: textStyle(type.noteTitle),
})
