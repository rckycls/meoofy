import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { Redirect, Tabs, router, usePathname } from 'expo-router'
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context'
import { TabBar, WebNav, colors, type NavKey } from '@pawpin/ui'

import { useRecordOnboardingPath } from '../../src/features/onboarding/useRecordOnboardingPath'
import { useLayoutMode } from '../../src/layout/layoutMode'
import { navKeyForPath, tabHref } from '../../src/navigation/tabs'
import { useSession } from '../../src/state/SessionProvider'

function select(key: NavKey) {
  router.navigate(tabHref[key])
}

const noTabBar = () => null

export default function TabsLayout() {
  const { signedIn } = useSession()
  // A first sign-in that lands in the tabs (not on O03) still records the O01 choice.
  useRecordOnboardingPath()
  const desktop = useLayoutMode() === 'desktop'
  const active = navKeyForPath(usePathname())
  const insets = useSafeAreaInsets()
  // Under the top nav the screens no longer touch the top edge.
  const screenInsets = useMemo(() => (desktop ? { ...insets, top: 0 } : insets), [desktop, insets])

  // The tabs are for signed-in users. A session that ends mid-use (sign-out,
  // or a read that came back UNAUTHENTICATED) lands here and goes to sign-in.
  if (!signedIn) return <Redirect href="/(auth)/sign-in" />

  return (
    <View style={styles.root}>
      {desktop ? (
        <View
          style={[
            styles.topNav,
            { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right },
          ]}
        >
          <WebNav active={active} onSelect={select} />
        </View>
      ) : null}
      <SafeAreaInsetsContext.Provider value={screenInsets}>
        <Tabs
          screenOptions={{ headerShown: false }}
          tabBar={desktop ? noTabBar : () => <TabBar active={active} onSelect={select} />}
        >
          {/* Expo Router shows only declared screens, in this order. */}
          <Tabs.Screen name="home" />
          <Tabs.Screen name="find" />
          <Tabs.Screen name="alerts" />
          <Tabs.Screen name="account" />
        </Tabs>
      </SafeAreaInsetsContext.Provider>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cloud },
  topNav: { backgroundColor: colors.white },
})
