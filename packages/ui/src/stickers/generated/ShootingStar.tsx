import * as React from 'react'
import Svg, { Path } from 'react-native-svg'
import type { SvgProps } from 'react-native-svg'
const SvgShootingStar = (props: SvgProps) => (
  <Svg viewBox="0 0 120 120" {...props}>
    <Path
      fill="#53749A"
      fillOpacity={0.18}
      stroke="#53749A"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeOpacity={0.18}
      strokeWidth={16}
      d="m80 20 7.35 15.89 17.38 2.08-12.84 11.89 3.39 17.17L80 58.5l-15.28 8.53 3.39-17.17-12.84-11.89 17.38-2.08ZM66 56c-18 12-34 30-52 54 24-16 42-28 62-42Z"
    />
    <Path
      fill="#FFF"
      stroke="#FFF"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={16}
      d="m80 14 7.35 15.89 17.38 2.08-12.84 11.89 3.39 17.17L80 52.5l-15.28 8.53 3.39-17.17-12.84-11.89 17.38-2.08ZM66 50c-18 12-34 30-52 54 24-16 42-28 62-42Z"
    />
    <Path fill="#CFE9FF" d="M66 50c-18 12-34 30-52 54 24-16 42-28 62-42Z" />
    <Path fill="#74C3FF" d="M69 54C55 64 42 78 28 96c18-12 32-22 47-36Z" />
    <Path
      fill="#FFD95A"
      stroke="#FFD95A"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={5}
      d="m80 14 7.35 15.89 17.38 2.08-12.84 11.89 3.39 17.17L80 52.5l-15.28 8.53 3.39-17.17-12.84-11.89 17.38-2.08Z"
    />
    <Path
      fill="#FFE58A"
      d="m80 22 5 11.12 12.12 1.32-9.04 8.19 2.5 11.93L80 48.5l-10.58 6.06 2.5-11.93-9.04-8.19L75 33.12Z"
    />
  </Svg>
)
export default SvgShootingStar
