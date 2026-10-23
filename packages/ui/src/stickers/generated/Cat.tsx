import * as React from 'react'
import Svg, { Path } from 'react-native-svg'
import type { SvgProps } from 'react-native-svg'
const SvgCat = (props: SvgProps) => (
  <Svg viewBox="0 0 120 120" {...props}>
    <Path
      fill="#53749A"
      fillOpacity={0.18}
      stroke="#53749A"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeOpacity={0.18}
      strokeWidth={12}
      d="m27 62 4-38 27 20Zm66 0-4-38-27 20ZM20 74a40 34 0 1 0 80 0 40 34 0 1 0-80 0"
    />
    <Path
      fill="#FFF"
      stroke="#FFF"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={12}
      d="m27 56 4-38 27 20Zm66 0-4-38-27 20ZM20 68a40 34 0 1 0 80 0 40 34 0 1 0-80 0"
    />
    <Path
      fill="#F4D9AE"
      stroke="#F4D9AE"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={4}
      d="m27 56 4-38 27 20ZM93 56l-4-38-27 20Z"
    />
    <Path
      fill="#FFC2CE"
      stroke="#FFC2CE"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="m34 46 2-18 14 10ZM86 46l-2-18-14 10Z"
    />
    <Path fill="#F4D9AE" d="M20 68a40 34 0 1 0 80 0 40 34 0 1 0-80 0" />
    <Path
      fill="none"
      stroke="#D7B589"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={3.2}
      d="M60 37v9M51 39l2 8M69 39l-2 8"
    />
    <Path
      fill="#FFC2CE"
      d="M32 76a6 4 0 1 0 12 0 6 4 0 1 0-12 0M76 76a6 4 0 1 0 12 0 6 4 0 1 0-12 0"
    />
    <Path
      fill="none"
      stroke="#5A4030"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2.8}
      d="M41 64q6-6 12 0M67 64q6-6 12 0"
    />
    <Path
      fill="#E58FA2"
      stroke="#E58FA2"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      d="M56.5 71h7L60 75.5Z"
    />
    <Path
      fill="none"
      stroke="#5A4030"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2.2}
      d="M53 78q3.5 4 7-.5 3.5 4.5 7 .5"
    />
    <Path
      fill="none"
      stroke="#C9A77A"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.8}
      d="m22 70 16 2M22 78l16-1M98 70l-16 2M98 78l-16-1"
    />
  </Svg>
)
export default SvgCat
