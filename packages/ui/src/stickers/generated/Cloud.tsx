import * as React from 'react'
import Svg, { Path } from 'react-native-svg'
import type { SvgProps } from 'react-native-svg'
const SvgCloud = (props: SvgProps) => (
  <Svg viewBox="0 0 120 120" {...props}>
    <Path
      fill="#53749A"
      fillOpacity={0.18}
      stroke="#53749A"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeOpacity={0.18}
      strokeWidth={12}
      d="M32 94C16 94 9 80 16 69c-5-14 8-25 23-20 5-16 27-22 37-7 12-8 32 0 30 19 13 3 13 32-5 33Z"
    />
    <Path
      fill="#FFF"
      stroke="#FFF"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={12}
      d="M32 88C16 88 9 74 16 63c-5-14 8-25 23-20 5-16 27-22 37-7 12-8 32 0 30 19 13 3 13 32-5 33Z"
    />
    <Path
      fill="#FFF"
      stroke="#D4E6FB"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M32 88C16 88 9 74 16 63c-5-14 8-25 23-20 5-16 27-22 37-7 12-8 32 0 30 19 13 3 13 32-5 33Z"
    />
    <Path
      fill="#FFC9D6"
      d="M40.5 72a4.5 3 0 1 0 9 0 4.5 3 0 1 0-9 0M75.5 72a4.5 3 0 1 0 9 0 4.5 3 0 1 0-9 0"
    />
    <Path
      fill="none"
      stroke="#6E93C8"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2.4}
      d="M47 64q4 4 8 0M70 64q4 4 8 0"
    />
    <Path
      fill="none"
      stroke="#6E93C8"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M58 71q4 4 8 0"
    />
  </Svg>
)
export default SvgCloud
