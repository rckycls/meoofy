import config from '../../app.config'

/** The options a config plugin is given, for `[name, options]` entries. */
function optionsOf(name: string): Record<string, unknown> {
  for (const plugin of config.plugins ?? []) {
    if (Array.isArray(plugin) && plugin[0] === name) return plugin[1] as Record<string, unknown>
  }
  throw new Error(`${name} is not a config plugin`)
}

// App Store review rejects vague usage strings, so each says what PawPin does with the access.
describe('the camera and photo library permission strings', () => {
  it('say what the camera is used for', () => {
    expect(optionsOf('expo-camera').cameraPermission).toBe(
      'PawPin uses the camera to take reference photos of your pet.',
    )
    expect(optionsOf('expo-image-picker').cameraPermission).toBe(
      optionsOf('expo-camera').cameraPermission,
    )
  })

  it('say what the photo library is used for', () => {
    expect(optionsOf('expo-image-picker').photosPermission).toBe(
      'PawPin uses your photo library so you can choose reference photos of your pet.',
    )
  })

  it('leave out the microphone and barcode scanning, which PawPin never uses', () => {
    expect(optionsOf('expo-camera')).toEqual(
      expect.objectContaining({
        microphonePermission: false,
        recordAudioAndroid: false,
        barcodeScannerEnabled: false,
      }),
    )
    expect(optionsOf('expo-image-picker').microphonePermission).toBe(false)
  })
})
