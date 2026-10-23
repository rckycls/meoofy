import { Pressable, StyleSheet, Text } from 'react-native'
import { Link } from 'expo-router'
import { colors, textStyle, type } from '@pawpin/ui'

/** An address outside the app, such as `mailto:help@example.com`. */
type ExternalHref = `${string}:${string}`

type Props = { label: string; disabled?: boolean } & (
  { onPress: () => void; href?: never } | { href: ExternalHref; onPress?: never }
)

/**
 * A quiet link: text only, with a tap target of at least 44 pt. Grey while disabled.
 *
 * With `onPress` it is an in-app action (a button). With `href` it is a link out of the app, such
 * as a `mailto:`: Expo Router opens it (the mail app on iOS, a real anchor on the web, so the
 * browser hands the address over itself) and it is announced as a link.
 */
export function TextLink({ label, disabled = false, ...target }: Props) {
  const content = <Text style={[styles.label, disabled ? styles.disabled : null]}>{label}</Text>

  if (target.href !== undefined) {
    return (
      <Link href={target.href} asChild>
        <Pressable accessibilityRole="link" style={styles.link}>
          {content}
        </Pressable>
      </Link>
    )
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={target.onPress}
      style={styles.link}
    >
      {content}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  label: { ...textStyle(type.noteTitle), color: colors.cobalt },
  disabled: { color: colors.slate },
})
