import { Stack } from 'expo-router'
import { colors } from '@meoofy/ui'

import { AuthFlowProvider } from '../../src/features/auth/AuthFlow'
import { useStepTransition } from '../../src/features/onboarding/transition'

/** Sign-in, the email code and the name step: one stack, each step moonrises in like onboarding. */
export default function AuthLayout() {
  const transition = useStepTransition()

  return (
    <AuthFlowProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.cloud },
          ...transition,
        }}
      />
    </AuthFlowProvider>
  )
}
