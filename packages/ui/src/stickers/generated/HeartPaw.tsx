import * as React from 'react'
import Svg, { Path } from 'react-native-svg'
import type { SvgProps } from 'react-native-svg'
const SvgHeartPaw = (props: SvgProps) => (
  <Svg viewBox="0 0 120 120" {...props}>
    <Path
      fill="#53749A"
      fillOpacity={0.18}
      stroke="#53749A"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeOpacity={0.18}
      strokeWidth={12}
      d="M60 108Q9 75 18 48c6-18 28-22 42-6 14-16 36-12 42 6q9 27-42 60"
    />
    <Path
      fill="#FFF"
      stroke="#FFF"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={12}
      d="M60 102Q9 69 18 42c6-18 28-22 42-6 14-16 36-12 42 6q9 27-42 60"
    />
    <Path fill="#FFB3C6" d="M60 102Q9 69 18 42c6-18 28-22 42-6 14-16 36-12 42 6q9 27-42 60" />
    <Path fill="#FFE3EA" d="M28.87 49.14a8 4.5-40 1 0 12.26-10.28 8 4.5-40 1 0-12.26 10.28" />
    <Path
      fill="#FFF"
      d="M49.88 71.52a10.12 8.28 0 1 0 20.24 0 10.12 8.28 0 1 0-20.24 0M43.81 58.64a4.23 4.23 0 1 0 8.46 0 4.23 4.23 0 1 0-8.46 0M51.17 52.2a4.23 4.23 0 1 0 8.46 0 4.23 4.23 0 1 0-8.46 0M60.37 52.2a4.23 4.23 0 1 0 8.46 0 4.23 4.23 0 1 0-8.46 0M67.73 58.64a4.23 4.23 0 1 0 8.46 0 4.23 4.23 0 1 0-8.46 0"
    />
  </Svg>
)
export default SvgHeartPaw
