import * as React from 'react'
import Svg, { Path } from 'react-native-svg'
import type { SvgProps } from 'react-native-svg'
const SvgRainbow = (props: SvgProps) => (
  <Svg viewBox="0 0 120 120" {...props}>
    <Path
      fill="#53749A"
      fillOpacity={0.18}
      stroke="#53749A"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeOpacity={0.18}
      strokeWidth={12}
      d="M14 84a46 46 0 0 1 92 0Zm-1 2a11 11 0 1 0 22 0 11 11 0 1 0-22 0m14 4a9 9 0 1 0 18 0 9 9 0 1 0-18 0M8 92a7 7 0 1 0 14 0 7 7 0 1 0-14 0m77-6a11 11 0 1 0 22 0 11 11 0 1 0-22 0m-10 4a9 9 0 1 0 18 0 9 9 0 1 0-18 0m23 2a7 7 0 1 0 14 0 7 7 0 1 0-14 0"
    />
    <Path
      fill="#FFF"
      stroke="#FFF"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={12}
      d="M14 78a46 46 0 0 1 92 0Zm-1 2a11 11 0 1 0 22 0 11 11 0 1 0-22 0m14 4a9 9 0 1 0 18 0 9 9 0 1 0-18 0M8 86a7 7 0 1 0 14 0 7 7 0 1 0-14 0m77-6a11 11 0 1 0 22 0 11 11 0 1 0-22 0m-10 4a9 9 0 1 0 18 0 9 9 0 1 0-18 0m23 2a7 7 0 1 0 14 0 7 7 0 1 0-14 0"
    />
    <Path fill="#FFB8C9" d="M14 78a46 46 0 0 1 92 0h-9a37 37 0 0 0-74 0Z" />
    <Path fill="#FFE58A" d="M23 78a37 37 0 0 1 74 0h-9a28 28 0 0 0-56 0Z" />
    <Path fill="#9ED6FF" d="M32 78a28 28 0 0 1 56 0h-9a19 19 0 0 0-38 0Z" />
    <Path fill="#FFF" d="M13 80a11 11 0 1 0 22 0 11 11 0 1 0-22 0" />
    <Path
      fill="#FFF"
      d="M27 84a9 9 0 1 0 18 0 9 9 0 1 0-18 0M8 86a7 7 0 1 0 14 0 7 7 0 1 0-14 0M85 80a11 11 0 1 0 22 0 11 11 0 1 0-22 0"
    />
    <Path
      fill="#FFF"
      d="M75 84a9 9 0 1 0 18 0 9 9 0 1 0-18 0M98 86a7 7 0 1 0 14 0 7 7 0 1 0-14 0"
    />
  </Svg>
)
export default SvgRainbow
