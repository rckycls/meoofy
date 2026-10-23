import * as React from 'react'
import Svg, { Path } from 'react-native-svg'
import type { SvgProps } from 'react-native-svg'
const SvgSparkle = (props: SvgProps) => (
  <Svg viewBox="0 0 120 120" {...props}>
    <Path
      fill="#53749A"
      fillOpacity={0.18}
      stroke="#53749A"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeOpacity={0.18}
      strokeWidth={12}
      d="M60 18c3 32 16 45 46 48-30 3-43 16-46 48-3-32-16-45-46-48 30-3 43-16 46-48m36 0c1 7 3 9 10 10-7 1-9 3-10 10-1-7-3-9-10-10 7-1 9-3 10-10"
    />
    <Path
      fill="#FFF"
      stroke="#FFF"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={12}
      d="M60 12c3 32 16 45 46 48-30 3-43 16-46 48-3-32-16-45-46-48 30-3 43-16 46-48m36 0c1 7 3 9 10 10-7 1-9 3-10 10-1-7-3-9-10-10 7-1 9-3 10-10"
    />
    <Path
      fill="#FFD95A"
      d="M60 12c3 32 16 45 46 48-30 3-43 16-46 48-3-32-16-45-46-48 30-3 43-16 46-48"
    />
    <Path
      fill="#FFF2AE"
      stroke="#F5C842"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M96 12c1 7 3 9 10 10-7 1-9 3-10 10-1-7-3-9-10-10 7-1 9-3 10-10"
    />
    <Path
      fill="none"
      stroke="#FFF2AE"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2.5}
      d="M60 34c1 18 6 24 24 26-18 2-23 6-24 24"
    />
  </Svg>
)
export default SvgSparkle
