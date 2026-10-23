import { Pressable, StyleSheet, Text, View } from 'react-native'

import { colors, space } from '../theme/tokens'
import { textStyle } from '../theme/textStyle'
import { type } from '../theme/type'

export type SwitchProps = {
  value: boolean
  onValueChange: (value: boolean) => void
  label: string
}

const TRACK_WIDTH = 52
const TRACK_HEIGHT = 32
const THUMB = 24
const INSET = 4

/**
 * The whole row is the control (one 48 pt target, one screen-reader stop);
 * the track and thumb are drawn, not a second native switch.
 */
export function Switch({ value, onValueChange, label }: SwitchProps) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onValueChange(!value)}
      style={styles.row}
    >
      <Text style={styles.label}>{label}</Text>
      <View aria-hidden style={[styles.track, value ? styles.trackOn : styles.trackOff]}>
        <View
          style={[
            styles.thumb,
            value ? styles.thumbOn : styles.thumbOff,
            { transform: [{ translateX: value ? TRACK_WIDTH - THUMB - INSET * 2 : 0 }] },
          ]}
        />
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[16],
  },
  label: { ...textStyle(type.body), flex: 1, color: colors.deepBlue },
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    borderWidth: 2,
    justifyContent: 'center',
    paddingHorizontal: INSET - 2,
  },
  // Off needs a 3:1 outline against the screen, so the track carries a slate
  // border and the thumb a slate fill; on is cobalt with a white thumb.
  trackOn: { backgroundColor: colors.cobalt, borderColor: colors.cobalt },
  trackOff: { backgroundColor: colors.mistGray, borderColor: colors.slate },
  thumb: { width: THUMB, height: THUMB, borderRadius: THUMB / 2 },
  thumbOn: { backgroundColor: colors.white },
  thumbOff: { backgroundColor: colors.slate },
})
