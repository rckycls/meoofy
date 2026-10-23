import type { ReactNode } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native'
import { ScreenShell, Sticker, colors, space, textStyle, type, type StickerName } from '@pawpin/ui'

import { ContentColumn } from '../../layout/ContentColumn'

type AuthFrameProps = {
  /** Decoration above the headline; hidden from assistive tech. */
  stickers: readonly StickerName[]
  title: string
  body: string
  children: ReactNode
}

/**
 * The shared layout of the owner-flow sign-in screens: stickers, headline and copy, then the
 * controls. The screen scrolls, so larger Dynamic Type grows it instead of clipping, and it lifts
 * above the keyboard on iOS.
 */
export function AuthFrame({ stickers, title, body, children }: AuthFrameProps) {
  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenShell flow="owner" scroll>
        <ContentColumn style={styles.column}>
          <View style={styles.header}>
            <View style={styles.stickers}>
              {stickers.map((name, index) => (
                <Sticker key={name} name={name} size={64} rotate={index % 2 === 0 ? -6 : 6} />
              ))}
            </View>
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            <Text style={styles.body}>{body}</Text>
          </View>
          <View style={styles.controls}>{children}</View>
        </ContentColumn>
      </ScreenShell>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  column: { gap: space[24] },
  header: { gap: space[8] },
  stickers: { flexDirection: 'row', gap: space[8], marginBottom: space[8] },
  title: { ...textStyle(type.headline), color: colors.deepBlue },
  body: { ...textStyle(type.body), color: colors.slate },
  controls: { gap: space[16] },
})
