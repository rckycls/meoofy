import { useEffect } from 'react'
// Per-weight imports: the package index would bundle all 18 Inter files.
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular'
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium'
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold'
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { colors } from '@meoofy/ui'

import { env } from '../src/env'
import { initSentry } from '../src/observability/sentry'
import { QueryProvider } from '../src/state/QueryProvider'
import { SessionProvider } from '../src/state/SessionProvider'

export {
  // The error screen for anything thrown while rendering a route: friendly words, and the error
  // goes to Sentry (scrubbed) when Sentry is on.
  ErrorBoundary,
} from '../src/observability/ErrorBoundary'

// Error reporting is off unless a DSN is set. It starts here, at module load, so it is running
// before anything renders.
if (env.sentryDsn) initSentry(env.sentryDsn)

// Keep the splash screen up until the fonts and the stored session are loaded.
void SplashScreen.preventAutoHideAsync()

function HideSplash() {
  useEffect(() => {
    void SplashScreen.hideAsync()
  }, [])
  return null
}

export default function RootLayout() {
  // `@meoofy/ui` text styles name these families (Inter_<weight>).
  const [fontsLoaded, fontError] = useFonts({
    Inter_400: Inter_400Regular,
    Inter_500: Inter_500Medium,
    Inter_600: Inter_600SemiBold,
    Inter_700: Inter_700Bold,
  })

  // If the fonts fail to load the app still opens, in the system font.
  if (!fontsLoaded && fontError === null) return null

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <QueryProvider>
          <HideSplash />
          <Stack
            screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.cloud } }}
          />
        </QueryProvider>
      </SessionProvider>
    </SafeAreaProvider>
  )
}
