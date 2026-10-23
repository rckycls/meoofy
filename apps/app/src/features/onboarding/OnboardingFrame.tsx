import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { ScreenShell, StepDots, colors, space, textStyle, type } from '@pawpin/ui'

import { ContentColumn } from '../../layout/ContentColumn'
import { onboardingCopy } from './copy'
import { PawMark } from './icons'

/** O00 to O02 are steps one to three; O03 comes after sign-in and has none. */
export const STEP_COUNT = 3

type OnboardingFrameProps = {
  /** Zero-based step for the dots in the top bar; leave out for O03. */
  step?: number
  hero: ReactNode
  title: string
  body: string
  /** What sits between the copy and the actions: chips, choices, promises. */
  children?: ReactNode
  /** The primary and secondary buttons, pinned to the bottom. */
  actions: ReactNode
}

/**
 * The shared layout of board 08: top bar (48), hero (268), copy block (128),
 * then the extras for the step, with the two 48 pt actions pinned to the
 * bottom. The screen scrolls, so larger Dynamic Type grows it instead of
 * clipping anything.
 */
export function OnboardingFrame({
  step,
  hero,
  title,
  body,
  children,
  actions,
}: OnboardingFrameProps) {
  return (
    <ScreenShell flow="onboarding" scroll>
      <ContentColumn style={styles.column}>
        <View style={styles.main}>
          <View testID="onboarding-top-bar" style={styles.topBar}>
            <View style={styles.side}>
              <PawMark color={colors.cobalt} />
            </View>
            <Text style={styles.brand}>{onboardingCopy.brand}</Text>
            <View style={[styles.side, styles.sideEnd]}>
              {step === undefined ? null : <StepDots count={STEP_COUNT} current={step} />}
            </View>
          </View>
          {hero}
          <View testID="onboarding-copy" style={styles.copy}>
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            <Text style={styles.body}>{body}</Text>
          </View>
          {children}
        </View>
        <View testID="onboarding-actions" style={styles.actions}>
          {actions}
        </View>
      </ContentColumn>
    </ScreenShell>
  )
}

const styles = StyleSheet.create({
  // Two groups spread apart: everything above, and the actions at the bottom.
  column: { flexGrow: 1, justifyContent: 'space-between', gap: space[24] },
  main: { gap: space[16] },
  topBar: { minHeight: 48, flexDirection: 'row', alignItems: 'center' },
  side: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  sideEnd: { justifyContent: 'flex-end' },
  brand: { ...textStyle(type.cardTitle), color: colors.deepBlue },
  copy: { minHeight: 128, gap: space[8] },
  title: { ...textStyle(type.headline), color: colors.deepBlue },
  body: { ...textStyle(type.body), color: colors.slate },
  actions: { gap: space[8] },
})
