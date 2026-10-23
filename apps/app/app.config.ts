import type { ExpoConfig } from 'expo/config'

/** What iOS shows when it asks for the camera, and what App Store review reads. */
const CAMERA_PERMISSION = 'PawPin uses the camera to take reference photos of your pet.'
const PHOTOS_PERMISSION =
  'PawPin uses your photo library so you can choose reference photos of your pet.'

/**
 * Uploading source maps and debug symbols to Sentry needs SENTRY_AUTH_TOKEN. Without it the native
 * release build steps fail the build ("To disable source maps auto upload, set
 * SENTRY_DISABLE_AUTO_UPLOAD=true"), so with no token the plugin writes that setting into the
 * native projects and the build simply skips the upload. SENTRY_DISABLE_AUTO_UPLOAD=true turns
 * the upload off even when a token is present.
 */
const SENTRY_UPLOAD_OFF =
  !process.env.SENTRY_AUTH_TOKEN || process.env.SENTRY_DISABLE_AUTO_UPLOAD === 'true'

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
  plugins: [
    'expo-router',
    // Reference photos only: no video, no microphone and no barcode scanning, so none of those
    // permissions (or their usage strings) are added.
    [
      'expo-camera',
      {
        cameraPermission: CAMERA_PERMISSION,
        microphonePermission: false,
        recordAudioAndroid: false,
        barcodeScannerEnabled: false,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: PHOTOS_PERMISSION,
        cameraPermission: CAMERA_PERMISSION,
        microphonePermission: false,
      },
    ],
    // Crash reporting itself starts from EXPO_PUBLIC_SENTRY_DSN (src/observability); this adds
    // only the native pieces and the source-map upload settings. The organisation and project
    // are optional, and the auth token is only ever read from SENTRY_AUTH_TOKEN at build time.
    [
      '@sentry/react-native/expo',
      {
        organization: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        disableAutoUpload: SENTRY_UPLOAD_OFF,
      },
    ],
  ],
}

export default config
