import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'

import { colors, radii, space } from '../theme/tokens'
import { textStyle } from '../theme/textStyle'
import { type } from '../theme/type'

export type ButtonVariant = 'primary' | 'secondary' | 'urgent'

export type ButtonProps = {
  label: string
  onPress: () => void
  variant: ButtonVariant
  disabled?: boolean
  /** Shows a spinner and ignores presses until the work finishes. */
  loading?: boolean
}

type Surface = { background: string; border: string; text: string }

const surfaces: Record<ButtonVariant, Surface> = {
  primary: { background: colors.cobalt, border: colors.cobalt, text: colors.white },
  secondary: { background: colors.white, border: colors.cobalt, text: colors.cobalt },
  urgent: { background: colors.deepBlue, border: colors.deepBlue, text: colors.white },
}

const disabledSurface: Surface = {
  background: colors.mistGray,
  border: colors.mistGray,
  text: colors.slate,
}

export function Button({
  label,
  onPress,
  variant,
  disabled = false,
  loading = false,
}: ButtonProps) {
  const inactive = disabled || loading
  const surface = disabled ? disabledSurface : surfaces[variant]

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: surface.background, borderColor: surface.border },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.content}>
        {loading ? <ActivityIndicator color={surface.text} /> : null}
        <Text style={[styles.label, { color: surface.text }]}>{label}</Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    // 48 pt is the design height; `minHeight` lets the label grow with
    // Dynamic Type instead of clipping.
    minHeight: 48,
    borderRadius: radii.button,
    borderWidth: 1.5,
    paddingHorizontal: space[24],
    justifyContent: 'center',
    alignItems: 'center',
  },
  pressed: { opacity: 0.85 },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[8] },
  label: { ...textStyle(type.cardTitle), textAlign: 'center' },
})
