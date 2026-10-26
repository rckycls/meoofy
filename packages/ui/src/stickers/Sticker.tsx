import type { ComponentType } from 'react'
import { View } from 'react-native'
import type { SvgProps } from 'react-native-svg'

import {
  Bone,
  Cat,
  Cloud,
  Dog,
  HeartPaw,
  LoveLetter,
  Meoofy,
  PawStar,
  PetTag,
  PrivacyShield,
  Rainbow,
  ShootingStar,
  SleepyMoon,
  Sparkle,
} from './generated'
import type { StickerName } from './names'

// A Record keeps this exhaustive: adding a name without its artwork, or the
// other way round, fails to compile.
const artwork: Record<StickerName, ComponentType<SvgProps>> = {
  dog: Dog,
  cat: Cat,
  'sleepy-moon': SleepyMoon,
  cloud: Cloud,
  'paw-star': PawStar,
  sparkle: Sparkle,
  'heart-paw': HeartPaw,
  'meoofy': Meoofy,
  'privacy-shield': PrivacyShield,
  'love-letter': LoveLetter,
  'pet-tag': PetTag,
  'shooting-star': ShootingStar,
  rainbow: Rainbow,
  bone: Bone,
}

export type StickerProps = {
  name: StickerName
  /** Width and height in px. */
  size?: number
  /** Clockwise tilt in degrees. */
  rotate?: number
}

/**
 * A die-cut sticker: white outline and soft shadow baked into the artwork.
 *
 * Stickers are decoration and never carry status, so they are hidden from
 * VoiceOver, TalkBack and the web accessibility tree. Anything a sticker
 * accompanies has to say the same thing in text.
 */
export function Sticker({ name, size = 64, rotate = 0 }: StickerProps) {
  const Artwork = artwork[name]

  return (
    <View
      testID={`sticker-${name}`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      style={[
        { width: size, height: size },
        rotate === 0 ? null : { transform: [{ rotate: `${rotate}deg` }] },
      ]}
    >
      <Artwork testID={`sticker-${name}-art`} width={size} height={size} />
    </View>
  )
}
