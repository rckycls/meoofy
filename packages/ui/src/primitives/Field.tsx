import { useState } from 'react'
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native'

import { cardRoles } from '../theme/roles'
import { colors, radii, space } from '../theme/tokens'
import { textStyle } from '../theme/textStyle'
import { type } from '../theme/type'

export type FieldProps = Omit<TextInputProps, 'style' | 'value' | 'onChangeText'> & {
  label: string
  value: string
  onChangeText: (text: string) => void
  /** Shown under the field and read out as the field's accessibility hint. */
  error?: string
}

const errorColor = cardRoles.warning.title

export function Field({
  label,
  value,
  onChangeText,
  error,
  accessibilityHint,
  onFocus,
  onBlur,
  ...inputProps
}: FieldProps) {
  const [focused, setFocused] = useState(false)
  const hasError = Boolean(error)
  const borderColor = hasError ? errorColor : focused ? colors.cobalt : colors.line

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.slate}
        {...inputProps}
        value={value}
        onChangeText={onChangeText}
        onFocus={(event) => {
          setFocused(true)
          onFocus?.(event)
        }}
        onBlur={(event) => {
          setFocused(false)
          onBlur?.(event)
        }}
        accessibilityLabel={label}
        accessibilityHint={hasError ? error : accessibilityHint}
        style={[styles.input, { borderColor }]}
      />
      {hasError ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  field: { gap: space[8] },
  label: { ...textStyle(type.noteTitle), color: colors.deepBlue },
  input: {
    ...textStyle(type.body),
    minHeight: 48,
    borderRadius: radii.field,
    borderWidth: 1.5,
    paddingHorizontal: space[16],
    backgroundColor: colors.white,
    color: colors.ink,
  },
  error: { ...textStyle(type.small), color: errorColor },
})
