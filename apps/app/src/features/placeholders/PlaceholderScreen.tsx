import { StyleSheet, Text } from 'react-native'
import {
  ScreenShell,
  Sticker,
  colors,
  space,
  textStyle,
  type,
  type Flow,
  type StickerName,
} from '@meoofy/ui'

import { ContentColumn } from '../../layout/ContentColumn'
import { placeholderCopy } from './copy'

export type PlaceholderKind = keyof typeof placeholderCopy

const look: Record<PlaceholderKind, { flow: Flow; sticker: StickerName }> = {
  find: { flow: 'finder', sticker: 'meoofy' },
  alerts: { flow: 'recovery', sticker: 'love-letter' },
}

/** A tab whose feature ships in a later pilot build. */
export function PlaceholderScreen({ kind }: { kind: PlaceholderKind }) {
  const { flow, sticker } = look[kind]
  const copy = placeholderCopy[kind]

  return (
    // The tab bar pads the bottom safe area itself.
    <ScreenShell flow={flow} scroll edges={['top', 'left', 'right']}>
      <ContentColumn style={styles.column}>
        <Sticker name={sticker} size={120} rotate={-6} />
        <Text accessibilityRole="header" style={styles.title}>
          {copy.title}
        </Text>
        <Text style={styles.body}>{copy.body}</Text>
      </ContentColumn>
    </ScreenShell>
  )
}

const styles = StyleSheet.create({
  column: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[16],
    paddingVertical: space[32],
  },
  title: { ...textStyle(type.section), color: colors.deepBlue, textAlign: 'center' },
  body: { ...textStyle(type.body), color: colors.slate, textAlign: 'center' },
})
