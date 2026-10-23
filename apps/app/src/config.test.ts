import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'

import config from '../app.config'

/** What `expo prebuild` and EAS Build resolve for the native projects (see `introspect`). */
type Resolved = {
  ios?: {
    bundleIdentifier?: string
    infoPlist?: Record<string, unknown>
    entitlements?: Record<string, unknown>
  }
}

type EasProfile = {
  extends?: string
  developmentClient?: boolean
  distribution?: string
  autoIncrement?: boolean | string
  environment?: string
  env?: Record<string, string>
}

type EasJson = {
  cli?: Record<string, unknown>
  build: Record<string, EasProfile>
  submit?: Record<string, unknown>
}

const appRoot = path.join(__dirname, '..')

/**
 * The native configuration the app's config really produces. This runs the Expo CLI's own
 * `config --type introspect`, which applies every config plugin (expo-camera, expo-image-picker,
 * Sentry, Sign in with Apple) in memory and prints the Info.plist and entitlements that
 * `expo prebuild` would write. That is the honest check of "the usage strings resolve": reading the
 * plugin props would only show what we passed in, not what the plugins do with it. It writes
 * nothing and needs no network.
 *
 * It runs in a scratch copy of the config with no `ios/` folder beside it. Beside the real one,
 * the CLI reads whatever Info.plist an earlier `expo prebuild` left in `apps/app/ios` (git-ignored)
 * and merges the plugins into that, so a stale native project could make this pass or fail on
 * its own. The scratch folder sits under node_modules so the plugins still resolve.
 */
function introspect(): Resolved {
  const cache = path.join(appRoot, 'node_modules', '.cache')
  mkdirSync(cache, { recursive: true })
  const scratch = mkdtempSync(path.join(cache, 'config-test-'))
  try {
    for (const file of ['app.config.ts', 'package.json']) {
      copyFileSync(path.join(appRoot, file), path.join(scratch, file))
    }
    const cli = require.resolve('expo/bin/cli')
    const stdout = execFileSync(
      process.execPath,
      [cli, 'config', '--type', 'introspect', '--json'],
      {
        cwd: scratch,
        encoding: 'utf8',
        env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1', EXPO_OFFLINE: '1' },
      },
    )
    // The CLI may print a notice before the JSON.
    return JSON.parse(stdout.slice(stdout.indexOf('{'))) as Resolved
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

function readEas(): EasJson {
  return JSON.parse(readFileSync(path.join(appRoot, 'eas.json'), 'utf8')) as EasJson
}

/** A profile as EAS resolves it: its `extends` chain first, the profile's own settings on top. */
function resolveProfile(eas: EasJson, name: string): EasProfile {
  const profile = eas.build[name]
  if (profile === undefined) throw new Error(`eas.json has no build profile "${name}"`)
  const parent = profile.extends === undefined ? {} : resolveProfile(eas, profile.extends)
  return { ...parent, ...profile, env: { ...parent.env, ...profile.env } }
}

describe('app.config.ts', () => {
  it('names the iOS app com.pawpin.pilot', () => {
    expect(config.ios?.bundleIdentifier).toBe('com.pawpin.pilot')
  })

  it('turns on Sign in with Apple for iOS', () => {
    expect(config.ios?.usesAppleSignIn).toBe(true)
  })

  it('exports the web app as static pages, for EAS Hosting', () => {
    expect(config.web?.output).toBe('static')
  })

  describe('as the native project gets it', () => {
    let resolved: Resolved
    let plist: Record<string, unknown>

    // Starting the Expo CLI takes about a second; a slow machine gets plenty of room.
    beforeAll(() => {
      resolved = introspect()
      plist = resolved.ios?.infoPlist ?? {}
    }, 60_000)

    it('keeps the bundle id', () => {
      expect(resolved.ios?.bundleIdentifier).toBe('com.pawpin.pilot')
    })

    it('tells the person why the camera is used, which App Store review reads', () => {
      expect(plist.NSCameraUsageDescription).toEqual(expect.stringMatching(/\S/))
      expect(plist.NSCameraUsageDescription).toBe(
        'PawPin uses the camera to take reference photos of your pet.',
      )
    })

    it('tells the person why the photo library is used', () => {
      expect(plist.NSPhotoLibraryUsageDescription).toEqual(expect.stringMatching(/\S/))
      expect(plist.NSPhotoLibraryUsageDescription).toBe(
        'PawPin uses your photo library so you can choose reference photos of your pet.',
      )
    })

    it('asks for no permission the app does not use', () => {
      // Reference photos only: no microphone, no saving to the library, no location.
      expect(plist).not.toHaveProperty('NSMicrophoneUsageDescription')
      expect(plist).not.toHaveProperty('NSPhotoLibraryAddUsageDescription')
      expect(plist).not.toHaveProperty('NSLocationWhenInUseUsageDescription')
    })

    it('carries the Sign in with Apple entitlement', () => {
      expect(resolved.ios?.entitlements?.['com.apple.developer.applesignin']).toEqual(['Default'])
    })
  })
})

describe('eas.json', () => {
  let eas: EasJson

  beforeAll(() => {
    eas = readEas()
  })

  it('has the three build profiles', () => {
    expect(Object.keys(eas.build).sort()).toEqual(['development', 'preview', 'production'])
  })

  it('builds a development client with the end-to-end seams on', () => {
    const development = resolveProfile(eas, 'development')

    expect(development.developmentClient).toBe(true)
    expect(development.env?.EXPO_PUBLIC_E2E).toBe('1')
  })

  it('shares the preview build with testers directly, as an internal build', () => {
    expect(resolveProfile(eas, 'preview').distribution).toBe('internal')
  })

  it('numbers every production build itself, so TestFlight never sees a repeat', () => {
    expect(resolveProfile(eas, 'production').autoIncrement).toBe(true)
    // Remote numbering is what lets EAS count builds across machines.
    expect(eas.cli?.appVersionSource).toBe('remote')
  })

  it('never sets EXPO_PUBLIC_E2E for production', () => {
    expect(eas.build.production?.env?.EXPO_PUBLIC_E2E).toBeUndefined()
    // Nor through an `extends` chain that reaches the development profile.
    expect(resolveProfile(eas, 'production').env?.EXPO_PUBLIC_E2E).toBeUndefined()
    expect(resolveProfile(eas, 'production').developmentClient).not.toBe(true)
  })

  it('does not ship the end-to-end seams in a preview build either', () => {
    expect(resolveProfile(eas, 'preview').env?.EXPO_PUBLIC_E2E).toBeUndefined()
  })

  it('reads each profile’s variables from the EAS environment of the same name', () => {
    for (const name of ['development', 'preview', 'production']) {
      expect(resolveProfile(eas, name).environment).toBe(name)
    }
  })

  it('keeps every other value out of the file: it comes from EAS environment variables', () => {
    const names = Object.values(eas.build).flatMap((profile) => Object.keys(profile.env ?? {}))
    expect(names.every((name) => name === 'EXPO_PUBLIC_E2E')).toBe(true)
  })

  it('submits production builds to TestFlight', () => {
    expect(eas.submit).toHaveProperty('production')
  })
})
