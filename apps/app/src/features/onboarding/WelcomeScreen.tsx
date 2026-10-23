import { StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { Button, colors, radii, space, textStyle, type } from '@pawpin/ui'

import { onboardingCopy } from './copy'
import { NightGardenHero } from './heroes'
import { Icon, type IconName } from './icons'
import { OnboardingFrame } from './OnboardingFrame'
import { rememberPath } from './progress'

const chipIcons: readonly IconName[] = ['lock', 'scan', 'heart']

/** O00: the promise, and two ways in. */
export function WelcomeScreen() {
  const copy = onboardingCopy.welcome

  async function foundAPet() {
    // Someone who found a pet has already chosen: skip the choice and show the
    // promises they will be relying on.
    await rememberPath('finder')
    router.navigate('/(onboarding)/privacy')
  }

  return (
    <OnboardingFrame
      step={0}
      hero={<NightGardenHero />}
      title={copy.title}
      body={copy.body}
      actions={
        <>
          <Button
            variant="primary"
            label={copy.primary}
            onPress={() => router.navigate('/(onboarding)/choose-path')}
          />
          <Button variant="secondary" label={copy.secondary} onPress={() => void foundAPet()} />
        </>
      }
    >
      <View style={styles.chips}>
        {copy.chips.map((label, index) => (
          <View key={label} style={styles.chip}>
            <Icon name={chipIcons[index]} size={16} color={colors.cobalt} />
            <Text style={styles.chipLabel}>{label}</Text>
          </View>
        ))}
      </View>
    </OnboardingFrame>
  )
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[8] },
  chip: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[8],
    paddingHorizontal: 12,
    borderRadius: radii.chip,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  chipLabel: { ...textStyle(type.small), color: colors.deepBlue },
})
