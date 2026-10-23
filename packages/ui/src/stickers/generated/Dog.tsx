import * as React from 'react'
import Svg, { Path } from 'react-native-svg'
import type { SvgProps } from 'react-native-svg'
const SvgDog = (props: SvgProps) => (
  <Svg viewBox="0 0 120 120" {...props}>
    <Path
      fill="#53749A"
      fillOpacity={0.18}
      stroke="#53749A"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeOpacity={0.18}
      strokeWidth={12}
      d="M17.84 55.21a14.005 28.01 20 1 0 26.32 9.58 14.005 28.01 20 1 0-26.32-9.58m58 9.58a28.01 14.005 70 1 0 26.32-9.58 28.01 14.005 70 1 0-26.32 9.58M24 68a36 36 0 1 0 72 0 36 36 0 1 0-72 0m30 38a6 6 0 1 0 12 0 6 6 0 1 0-12 0"
    />
    <Path
      fill="#FFF"
      stroke="#FFF"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={12}
      d="M17.84 49.21a14 28 20 1 0 26.32 9.58 14 28 20 1 0-26.32-9.58m58 9.58a14 28-20 1 0 26.32-9.58 14 28-20 1 0-26.32 9.58M24 62a36 36 0 1 0 72 0 36 36 0 1 0-72 0m30 38a6 6 0 1 0 12 0 6 6 0 1 0-12 0"
    />
    <Path
      fill="#8A6342"
      d="M17.84 49.21a14 28 20 1 0 26.32 9.58 14 28 20 1 0-26.32-9.58M75.84 58.79a14 28-20 1 0 26.32-9.58 14 28-20 1 0-26.32 9.58"
    />
    <Path fill="#EECB97" d="M24 62a36 36 0 1 0 72 0 36 36 0 1 0-72 0" />
    <Path
      fill="#FFC2CE"
      d="M31 75a6 4 0 1 0 12 0 6 4 0 1 0-12 0M77 75a6 4 0 1 0 12 0 6 4 0 1 0-12 0"
    />
    <Path fill="#FFF4DC" d="M39 79a21 15 0 1 0 42 0 21 15 0 1 0-42 0" />
    <Path
      fill="#3E2F25"
      d="M41.5 58a4.5 5.5 0 1 0 9 0 4.5 5.5 0 1 0-9 0M69.5 58a4.5 5.5 0 1 0 9 0 4.5 5.5 0 1 0-9 0"
    />
    <Path
      fill="#FFF"
      d="M46 56.2a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0M74 56.2a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0"
    />
    <Path fill="#3E2F25" d="M53 71a7 5 0 1 0 14 0 7 5 0 1 0-14 0" />
    <Path fill="#FF9DB0" d="M57 82q3 8 6 0Z" />
    <Path
      fill="none"
      stroke="#6B4B36"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2.4}
      d="M52 79q4 5 8 0 4 5 8 0"
    />
    <Path
      fill="none"
      stroke="#2858C8"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={6}
      d="M36 91q24 13 48 0"
    />
    <Path
      fill="#FFD95A"
      stroke="#FFD95A"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      d="M54 100a6 6 0 1 0 12 0 6 6 0 1 0-12 0"
    />
  </Svg>
)
export default SvgDog
