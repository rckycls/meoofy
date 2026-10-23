import * as React from 'react'
import Svg, { Path } from 'react-native-svg'
import type { SvgProps } from 'react-native-svg'
const SvgPawPin = (props: SvgProps) => (
  <Svg viewBox="0 0 120 120" {...props}>
    <Path
      fill="#53749A"
      fillOpacity={0.18}
      stroke="#53749A"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeOpacity={0.18}
      strokeWidth={12}
      d="M60 116S22 80 22 54c0-21 17-38 38-38s38 17 38 38c0 26-38 62-38 62"
    />
    <Path
      fill="#FFF"
      stroke="#FFF"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={12}
      d="M60 110S22 74 22 48c0-21 17-38 38-38s38 17 38 38c0 26-38 62-38 62"
    />
    <Path fill="#2858C8" d="M60 110S22 74 22 48c0-21 17-38 38-38s38 17 38 38c0 26-38 62-38 62" />
    <Path fill="#5A82E0" d="M31.1 33.75a4.5 9 30 1 0 7.8 4.5 4.5 9 30 1 0-7.8-4.5" />
    <Path fill="#FFF" d="M36 48a24 24 0 1 0 48 0 24 24 0 1 0-48 0" />
    <Path
      fill="#2858C8"
      d="M51.42 54.68a8.58 7.02 0 1 0 17.16 0 8.58 7.02 0 1 0-17.16 0M46.27 43.76a3.59 3.59 0 1 0 7.18 0 3.59 3.59 0 1 0-7.18 0M52.51 38.3a3.59 3.59 0 1 0 7.18 0 3.59 3.59 0 1 0-7.18 0M60.31 38.3a3.59 3.59 0 1 0 7.18 0 3.59 3.59 0 1 0-7.18 0M66.55 43.76a3.59 3.59 0 1 0 7.18 0 3.59 3.59 0 1 0-7.18 0"
    />
  </Svg>
)
export default SvgPawPin
