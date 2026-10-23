import type { ExpoConfig } from 'expo/config'

const config: ExpoConfig = {
  name: 'PawPin',
  slug: 'pawpin',
  scheme: 'pawpin',
  version: '1.0.0',
  orientation: 'portrait',
  // The design is light-only (pastel flow tints, light glow blur).
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'com.pawpin.pilot',
    supportsTablet: true,
  },
  web: {
    bundler: 'metro',
    output: 'single',
  },
  plugins: ['expo-router'],
}

export default config
