import { Pressable, StyleSheet, Text } from 'react-native'
import { colors, textStyle, type } from '@pawpin/ui'

/** A quiet in-app link: text only, with a tap target of at least 44 pt. Grey while disabled. */
export function TextLink({
  label,
  onPress,
  disabled = false,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.link}
    >
      <Text style={[styles.label, disabled ? styles.disabled : null]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  label: { ...textStyle(type.noteTitle), color: colors.cobalt },
  disabled: { color: colors.slate },
})
