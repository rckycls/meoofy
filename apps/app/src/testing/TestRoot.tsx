import type { ReactNode } from 'react'
import { Slot } from 'expo-router'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { PawpinClient } from '@pawpin/api'

import { QueryProvider } from '../state/QueryProvider'
import { SessionProvider } from '../state/SessionProvider'

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, right: 0, bottom: 34, left: 0 },
}

/** The app's providers around `children`, with an injected client. */
export function TestProviders({ client, children }: { client: PawpinClient; children: ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <SessionProvider client={client}>
        <QueryProvider>{children}</QueryProvider>
      </SessionProvider>
    </SafeAreaProvider>
  )
}

/** A root `_layout` for `renderRouter`: the app's providers around the routes. */
export function testRootLayout(client: PawpinClient) {
  return function TestRootLayout() {
    return (
      <TestProviders client={client}>
        <Slot />
      </TestProviders>
    )
  }
}
