import * as React from 'react'
import Svg, { Path } from 'react-native-svg'
import type { SvgProps } from 'react-native-svg'
const SvgPawStar = (props: SvgProps) => (
  <Svg viewBox="0 0 120 120" {...props}>
    <Path
      fill="#53749A"
      fillOpacity={0.18}
      stroke="#53749A"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeOpacity={0.18}
      strokeWidth={18}
      d="m60 19 14.69 29.77 32.86 4.78-23.77 23.18 5.61 32.72L60 94l-29.39 15.45 5.61-32.72-23.77-23.18 32.86-4.78Z"
    />
    <Path
      fill="#FFF"
      stroke="#FFF"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={18}
      d="m60 13 14.69 29.77 32.86 4.78-23.77 23.18 5.61 32.72L60 88l-29.39 15.45 5.61-32.72-23.77-23.18 32.86-4.78Z"
    />
    <Path
      fill="#FFD95A"
      stroke="#FFD95A"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={6}
      d="m60 13 14.69 29.77 32.86 4.78-23.77 23.18 5.61 32.72L60 88l-29.39 15.45 5.61-32.72-23.77-23.18 32.86-4.78Z"
    />
    <Path
      fill="#FFE58A"
      d="m60 23 11.76 23.82 26.28 3.82-19.02 18.54 4.49 26.18L60 83 36.49 95.36l4.49-26.18-19.02-18.54 26.28-3.82Z"
    />
    <Path
      fill="#8A6342"
      d="M48.45 74.3a11.55 9.45 0 1 0 23.1 0 11.55 9.45 0 1 0-23.1 0M41.52 59.6a4.83 4.83 0 1 0 9.66 0 4.83 4.83 0 1 0-9.66 0M49.92 52.25a4.83 4.83 0 1 0 9.66 0 4.83 4.83 0 1 0-9.66 0M60.42 52.25a4.83 4.83 0 1 0 9.66 0 4.83 4.83 0 1 0-9.66 0M68.82 59.6a4.83 4.83 0 1 0 9.66 0 4.83 4.83 0 1 0-9.66 0"
    />
  </Svg>
)
export default SvgPawStar
