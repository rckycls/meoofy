import * as React from 'react'
import Svg, { Path } from 'react-native-svg'
import type { SvgProps } from 'react-native-svg'
const SvgLoveLetter = (props: SvgProps) => (
  <Svg viewBox="0 0 120 120" {...props}>
    <Path
      fill="#53749A"
      fillOpacity={0.18}
      stroke="#53749A"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeOpacity={0.18}
      strokeWidth={12}
      d="M20 38h80a8 8 0 0 1 8 8v48a8 8 0 0 1-8 8H20a8 8 0 0 1-8-8V46a8 8 0 0 1 8-8"
    />
    <Path
      fill="#FFF"
      stroke="#FFF"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={12}
      d="M20 32h80a8 8 0 0 1 8 8v48a8 8 0 0 1-8 8H20a8 8 0 0 1-8-8V40a8 8 0 0 1 8-8"
    />
    <Path
      fill="#FFF"
      stroke="#CFE0F6"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M20 32h80a8 8 0 0 1 8 8v48a8 8 0 0 1-8 8H20a8 8 0 0 1-8-8V40a8 8 0 0 1 8-8"
    />
    <Path
      fill="none"
      stroke="#DCE8F8"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="m15 92 35-28M105 92 70 64"
    />
    <Path
      fill="none"
      stroke="#A9C3E6"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2.6}
      d="m15 38 45 32 45-32"
    />
    <Path
      fill="#FF9FB6"
      stroke="#FFF"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2.5}
      d="M60 85.6Q42.66 74.38 45.72 65.2c2.04-6.12 9.52-7.48 14.28-2.04 4.76-5.44 12.24-4.08 14.28 2.04Q77.34 74.38 60 85.6"
    />
  </Svg>
)
export default SvgLoveLetter
