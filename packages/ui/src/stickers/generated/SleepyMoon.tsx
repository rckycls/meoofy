import * as React from 'react'
import Svg, { Path } from 'react-native-svg'
import type { SvgProps } from 'react-native-svg'
const SvgSleepyMoon = (props: SvgProps) => (
  <Svg viewBox="0 0 120 120" {...props}>
    <Path
      fill="#53749A"
      fillOpacity={0.18}
      stroke="#53749A"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeOpacity={0.18}
      strokeWidth={12}
      d="M55.09 24.01a44 44 0 1 0 40.46 58.46 36 36 0 0 1-40.46-58.46"
    />
    <Path
      fill="#FFF"
      stroke="#FFF"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={12}
      d="M55.09 18.01a44 44 0 1 0 40.46 58.46 36 36 0 0 1-40.46-58.46"
    />
    <Path fill="#FFD95A" d="M55.09 18.01a44 44 0 1 0 40.46 58.46 36 36 0 0 1-40.46-58.46" />
    <Path
      fill="#F5C842"
      d="M42.6 98a3.4 3.4 0 1 0 6.8 0 3.4 3.4 0 1 0-6.8 0M19.4 50a2.6 2.6 0 1 0 5.2 0 2.6 2.6 0 1 0-5.2 0"
    />
    <Path
      fill="none"
      stroke="#B98C1E"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2.6}
      d="M24 70q6 5 12 0"
    />
    <Path fill="#FFB7A8" d="M25 80a5 3.4 0 1 0 10 0 5 3.4 0 1 0-10 0" />
  </Svg>
)
export default SvgSleepyMoon
