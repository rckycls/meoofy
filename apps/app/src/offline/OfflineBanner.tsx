import { StyleSheet, Text, View } from 'react-native'
import { cardRoles, radii, space, textStyle, type } from '@pawpin/ui'

import { offlineCopy } from './copy'
import { useOnline } from './useOnline'

const colours = cardRoles.attention

type EdgeInsets = { top: number; left: number; right: number }

/**
 * Says the device is offline and saved information can still be seen; nothing while online.
 *
 * It is status text: it never animates, and assistive technology hears it as a status (a polite
 * live region), not an alert. Given `insets` it is a bar across the top of the screen that keeps
 * clear of them (the status bar on a phone); without, a box in the page's column.
 */
export function OfflineBanner({ insets }: { insets?: EdgeInsets }) {
  const online = useOnline()
  if (online) return null

  const placement =
    insets === undefined
      ? styles.box
      : {
          paddingTop: insets.top + space[8],
          paddingLeft: insets.left + space[16],
          paddingRight: insets.right + space[16],
        }
  return (
    <View
      accessible
      role="status"
      accessibilityLiveRegion="polite"
      style={[styles.banner, placement]}
    >
      <Text style={styles.text}>{offlineCopy.banner}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colours.from,
    paddingVertical: space[8],
    paddingHorizontal: space[16],
  },
  box: { borderRadius: radii.field },
  text: { ...textStyle(type.noteTitle), color: colours.body },
})
