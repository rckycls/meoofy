import * as React from 'react'
import Svg, { Path } from 'react-native-svg'
import type { SvgProps } from 'react-native-svg'
const SvgPetTag = (props: SvgProps) => (
  <Svg viewBox="0 0 120 120" {...props}>
    <Path
      fill="#53749A"
      fillOpacity={0.18}
      stroke="#53749A"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeOpacity={0.18}
      strokeWidth={12}
      d="M36 36h48a12 12 0 0 1 12 12v50a16 16 0 0 1-16 16H40a16 16 0 0 1-16-16V48a12 12 0 0 1 12-12m12-9a12 12 0 1 0 24 0 12 12 0 1 0-24 0"
    />
    <Path
      fill="#FFF"
      stroke="#FFF"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={12}
      d="M36 30h48a12 12 0 0 1 12 12v50a16 16 0 0 1-16 16H40a16 16 0 0 1-16-16V42a12 12 0 0 1 12-12m12-9a12 12 0 1 0 24 0 12 12 0 1 0-24 0"
    />
    <Path
      fill="none"
      stroke="#8A6342"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={4}
      d="M51 21a9 9 0 1 0 18 0 9 9 0 1 0-18 0"
    />
    <Path
      fill="#D7B589"
      d="M36 30h48a12 12 0 0 1 12 12v50a16 16 0 0 1-16 16H40a16 16 0 0 1-16-16V42a12 12 0 0 1 12-12"
    />
    <Path fill="#8A6342" d="M56 39a4 4 0 1 0 8 0 4 4 0 1 0-8 0" />
    <Path
      fill="#FFF"
      d="M40 50h40a6 6 0 0 1 6 6v32a6 6 0 0 1-6 6H40a6 6 0 0 1-6-6V56a6 6 0 0 1 6-6"
    />
    <Path fill="#183B73" d="M40 56h10v10H40Z" />
    <Path fill="#FFF" d="M42 58h6v6h-6Z" />
    <Path fill="#183B73" d="M43.6 59.6h2.8v2.8h-2.8ZM70 56h10v10H70Z" />
    <Path fill="#FFF" d="M72 58h6v6h-6Z" />
    <Path fill="#183B73" d="M73.6 59.6h2.8v2.8h-2.8ZM40 78h10v10H40Z" />
    <Path fill="#FFF" d="M42 80h6v6h-6Z" />
    <Path
      fill="#183B73"
      d="M43.6 81.6h2.8v2.8h-2.8ZM55 57h3.4v3.4H55ZM60 57h3.4v3.4H60ZM55 62h3.4v3.4H55ZM63 63h3.4v3.4H63ZM57 67h3.4v3.4H57ZM52 71h3.4v3.4H52ZM61 72h3.4v3.4H61ZM68 70h3.4v3.4H68ZM74 73h3.4v3.4H74ZM56 80h3.4v3.4H56ZM64 79h3.4v3.4H64ZM69 84h3.4v3.4H69ZM75 81h3.4v3.4H75ZM60 86h3.4v3.4H60ZM78 87h3.4v3.4H78Z"
    />
  </Svg>
)
export default SvgPetTag
