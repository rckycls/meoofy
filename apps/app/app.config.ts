import type { ExpoConfig } from 'expo/config'

/** What iOS shows when it asks for the camera, and what App Store review reads. */
const CAMERA_PERMISSION = 'PawPin uses the camera to take reference photos of your pet.'
const PHOTOS_PERMISSION =
  'PawPin uses your photo library so you can choose reference photos of your pet.'

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
  ],
}

export default config
