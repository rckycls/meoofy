import { useImperativeHandle, useRef, useState, type ComponentRef, type Ref } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { cardRoles, colors, radii, space, textStyle, type } from '@meoofy/ui'

import { CODE_LENGTH } from './validation'

const CELL_HEIGHT = 56
const errorColor = cardRoles.warning.title

/**
 * The text field is drawn nearly, not fully, transparent. iOS (Fabric) does not hit-test a view
 * whose alpha is below 0.01, so a field at `opacity: 0` could not be tapped; this is still
 * invisible next to transparent text and a hidden caret.
 */
const FIELD_OPACITY = 0.011

export type CodeInputHandle = {
  /** Puts the cursor in the field, which opens the keyboard. */
  focus: () => void
}

type CodeInputProps = {
  label: string
  value: string
  onChangeText: (text: string) => void
  /** The last code was refused: the boxes turn the warning colour. */
  invalid?: boolean
  ref?: Ref<CodeInputHandle>
}

/**
 * The code entry of F08: one box per digit. A single, almost transparent text field lies over the
 * boxes, so there is one control to focus, to paste into, to autofill from the email and to read
 * out, instead of six. The boxes are a tap target of their own that focuses the field, in case a
 * platform lets a tap through the field.
 *
 * The field stays editable at all times: turning `editable` off drops the keyboard on iOS and
 * nothing would bring it back. The owner decides whether to accept what is typed.
 */
export function CodeInput({ label, value, onChangeText, invalid = false, ref }: CodeInputProps) {
  const [focused, setFocused] = useState(false)
  const input = useRef<ComponentRef<typeof TextInput>>(null)
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), [])
  const activeCell = focused ? Math.min(value.length, CODE_LENGTH - 1) : -1

  return (
    <Pressable
      testID="code-boxes"
      accessible={false}
      onPress={() => input.current?.focus()}
      style={styles.wrap}
    >
      <View aria-hidden style={styles.cells}>
        {Array.from({ length: CODE_LENGTH }, (_, index) => (
          <View
            key={index}
            style={[
              styles.cell,
              index === activeCell && styles.cellActive,
              invalid && styles.cellInvalid,
            ]}
          >
            <Text style={styles.digit}>{value[index] ?? ''}</Text>
          </View>
        ))}
      </View>
      <TextInput
        ref={input}
        testID="code-input"
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoFocus
        keyboardType="number-pad"
        inputMode="numeric"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        autoCorrect={false}
        caretHidden
        selectionColor="transparent"
        style={styles.input}
      />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  wrap: { minHeight: CELL_HEIGHT },
  cells: { flexDirection: 'row', gap: space[8] },
  cell: {
    flex: 1,
    height: CELL_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.field,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  cellActive: { borderColor: colors.cobalt },
  cellInvalid: { borderColor: errorColor },
  digit: { ...textStyle(type.section), color: colors.ink },
  // Over the boxes and as tall as they are. 16 pt text stops iOS Safari zooming in.
  input: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    minHeight: CELL_HEIGHT,
    opacity: FIELD_OPACITY,
    fontSize: 16,
    color: 'transparent',
  },
})
