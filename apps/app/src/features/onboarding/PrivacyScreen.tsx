import { StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { Button, colors, radii, space, textStyle, type } from '@pawpin/ui'

import { onboardingCopy } from './copy'
import { SafeOrbitHero } from './heroes'
import { Icon } from './icons'
import { OnboardingFrame } from './OnboardingFrame'
import { markOnboardingSeen, stepBack } from './progress'

/** O02: the three promises. Onboarding is done once the person agrees. */
export function PrivacyScreen() {
  const copy = onboardingCopy.privacy

  async function agree() {
    await markOnboardingSeen()
    router.replace('/(auth)/sign-in')
  }

  return (
    <OnboardingFrame
      step={2}
      hero={<SafeOrbitHero />}
      title={copy.title}
      body={copy.body}
      actions={
        <>
          <Button variant="primary" label={copy.primary} onPress={() => void agree()} />
          <Button
            variant="secondary"
            label={copy.secondary}
            onPress={() => stepBack('/(onboarding)/choose-path')}
          />
        </>
      }
    >
      {/* Privacy text never animates: the promises are there from the first frame. */}
      <View role="list" style={styles.promises}>
        {copy.promises.map((promise) => (
          <View key={promise} role="listitem" testID="promise" style={styles.promise}>
            <View style={styles.check}>
              <Icon name="check" size={14} color={colors.deepBlue} strokeWidth={2.5} />
            </View>
            <Text style={styles.promiseText}>{promise}</Text>
          </View>
        ))}
      </View>
    </OnboardingFrame>
  )
}

const styles = StyleSheet.create({
  promises: { gap: space[8] },
  promise: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radii.field,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.softYellow,
  },
  promiseText: { ...textStyle(type.body), flex: 1, color: colors.deepBlue },
})
