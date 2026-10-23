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
import { colors } from '@pawpin/ui'

import { QueryProvider } from '../src/state/QueryProvider'
import { SessionProvider } from '../src/state/SessionProvider'

export {
  // Expo Router's error screen for anything thrown while rendering a route.
  ErrorBoundary,
} from 'expo-router'

// Keep the splash screen up until the fonts and the stored session are loaded.
void SplashScreen.preventAutoHideAsync()

function HideSplash() {
  useEffect(() => {
    void SplashScreen.hideAsync()
  }, [])
  return null
}

export default function RootLayout() {
  // `@pawpin/ui` text styles name these families (Inter_<weight>).
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
