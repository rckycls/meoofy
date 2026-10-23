import { Stack } from 'expo-router'
import { colors } from '@pawpin/ui'

import { useStepTransition } from '../../src/features/onboarding/transition'

/** O00 → O01 → O02 (and O03 after sign-in): one stack, each step moonrises in. */
export default function OnboardingLayout() {
  const transition = useStepTransition()

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.cloud },
        ...transition,
      }}
    />
  )
}
