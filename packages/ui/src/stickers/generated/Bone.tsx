import * as React from 'react'
import Svg, { Path } from 'react-native-svg'
import type { SvgProps } from 'react-native-svg'
const SvgBone = (props: SvgProps) => (
  <Svg viewBox="0 0 120 120" {...props}>
    <Path
      fill="#53749A"
      fillOpacity={0.18}
      stroke="#53749A"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeOpacity={0.18}
      strokeWidth={12}
      d="M30 56h60v20H30Zm-15-2a13 13 0 1 0 26 0 13 13 0 1 0-26 0m0 24a13 13 0 1 0 26 0 13 13 0 1 0-26 0m64-24a13 13 0 1 0 26 0 13 13 0 1 0-26 0m0 24a13 13 0 1 0 26 0 13 13 0 1 0-26 0"
    />
    <Path
      fill="#FFF"
      stroke="#FFF"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={12}
      d="M30 50h60v20H30Zm-15-2a13 13 0 1 0 26 0 13 13 0 1 0-26 0m0 24a13 13 0 1 0 26 0 13 13 0 1 0-26 0m64-24a13 13 0 1 0 26 0 13 13 0 1 0-26 0m0 24a13 13 0 1 0 26 0 13 13 0 1 0-26 0"
    />
    <Path fill="#F7E2BC" d="M30 50h60v20H30Z" />
    <Path fill="#F7E2BC" d="M15 48a13 13 0 1 0 26 0 13 13 0 1 0-26 0" />
    <Path
      fill="#F7E2BC"
      d="M15 72a13 13 0 1 0 26 0 13 13 0 1 0-26 0M79 48a13 13 0 1 0 26 0 13 13 0 1 0-26 0"
    />
    <Path fill="#F7E2BC" d="M79 72a13 13 0 1 0 26 0 13 13 0 1 0-26 0" />
    <Path
      fill="none"
      stroke="#FFF"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={3.5}
      d="M36 55h42"
    />
    <Path fill="#FFF" d="M20.5 44a3.5 3.5 0 1 0 7 0 3.5 3.5 0 1 0-7 0" />
  </Svg>
)
export default SvgBone
