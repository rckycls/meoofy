import { Pressable, StyleSheet, Text } from 'react-native'
import { colors, textStyle, type } from '@pawpin/ui'

/** A quiet in-app link: text only, with a tap target of at least 44 pt. */
export function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.link}>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  label: { ...textStyle(type.noteTitle), color: colors.cobalt },
})
