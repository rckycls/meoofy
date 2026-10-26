import { StyleSheet, Text } from 'react-native'
import { colors, textStyle, type } from '@meoofy/ui'

/**
 * Why the controls next to it are off while the device is offline. Plain status text, shown
 * before the controls so it is read first; it never animates.
 */
export function OfflineNote({ children }: { children: string }) {
  return <Text style={styles.note}>{children}</Text>
}

const styles = StyleSheet.create({
  note: { ...textStyle(type.body), color: colors.slate },
})
