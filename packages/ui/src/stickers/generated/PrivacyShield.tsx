import * as React from 'react'
import Svg, { Path } from 'react-native-svg'
import type { SvgProps } from 'react-native-svg'
const SvgPrivacyShield = (props: SvgProps) => (
  <Svg viewBox="0 0 120 120" {...props}>
    <Path
      fill="#53749A"
      fillOpacity={0.18}
      stroke="#53749A"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeOpacity={0.18}
      strokeWidth={12}
      d="m60 16 38 14c2 38-12 68-38 84-26-16-40-46-38-84Z"
    />
    <Path
      fill="#FFF"
      stroke="#FFF"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={12}
      d="m60 10 38 14c2 38-12 68-38 84-26-16-40-46-38-84Z"
    />
    <Path
      fill="#74C3FF"
      stroke="#74C3FF"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={4}
      d="m60 10 38 14c2 38-12 68-38 84-26-16-40-46-38-84Z"
    />
    <Path fill="#DCEEFF" d="m60 22 28 10c1 30-9 52-28 64-19-12-29-34-28-64Z" />
    <Path
      fill="none"
      stroke="#2858C8"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={5}
      d="M50 58v-8a10 10 0 0 1 20 0v8"
    />
    <Path
      fill="#2858C8"
      d="M44 56h32a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H44a4 4 0 0 1-4-4V60a4 4 0 0 1 4-4"
    />
    <Path fill="#FFF" d="M56.4 66a3.6 3.6 0 1 0 7.2 0 3.6 3.6 0 1 0-7.2 0" />
    <Path fill="#FFF" d="M58.4 67h3.2v7h-3.2Z" />
  </Svg>
)
export default SvgPrivacyShield
