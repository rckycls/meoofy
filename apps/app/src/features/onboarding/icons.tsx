import type { ReactNode } from 'react'
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg'

export type IconName = 'lock' | 'scan' | 'heart' | 'shield-check' | 'scan-search' | 'check' | 'plus'

type IconProps = {
  name: IconName
  size?: number
  color: string
  /** Stroke width in the 24 x 24 drawing. */
  strokeWidth?: number
}

/**
 * The few line icons the onboarding screens need, drawn on a 24 x 24 grid.
 * They sit next to text that says the same thing, so they are hidden from
 * assistive tech.
 */
export function Icon({ name, size = 20, color, strokeWidth = 2 }: IconProps) {
  return (
    <Svg
      testID={`icon-${name}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
    >
      {shapes[name]}
    </Svg>
  )
}

const corners =
  'M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2'

const shapes: Record<IconName, ReactNode> = {
  lock: (
    <>
      <Rect x={5} y={11} width={14} height={9} rx={2} />
      <Path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  scan: (
    <>
      <Path d={corners} />
      <Path d="M8 12h8" />
    </>
  ),
  heart: <Path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  'shield-check': (
    <>
      <Path d="M12 3l7 3v5c0 4.4-3 7.8-7 10-4-2.2-7-5.6-7-10V6l7-3z" />
      <Path d="M9 12l2 2 4-4" />
    </>
  ),
  'scan-search': (
    <>
      <Path d={corners} />
      <Circle cx={12} cy={12} r={3} />
      <Path d="M14.2 14.2L16 16" />
    </>
  ),
  check: <Path d="M5 12.5l4.5 4.5L19 7.5" />,
  plus: <Path d="M12 5v14M5 12h14" />,
}

/** The PawPin mark in the top bar: four toes and a pad, outlined. */
export function PawMark({ size = 24, color }: { size?: number; color: string }) {
  return (
    <Svg
      testID="paw-mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
    >
      <Ellipse cx={5.5} cy={11} rx={1.8} ry={2.4} />
      <Ellipse cx={9.5} cy={6} rx={1.8} ry={2.4} />
      <Ellipse cx={15} cy={6} rx={1.8} ry={2.4} />
      <Ellipse cx={19} cy={11} rx={1.8} ry={2.4} />
      <Path d="M12 11c-3 0-5.5 3.6-5.5 6 0 1.8 1.5 2.5 3 2.5 1 0 1.6-.4 2.5-.4s1.5.4 2.5.4c1.5 0 3-.7 3-2.5 0-2.4-2.5-6-5.5-6z" />
    </Svg>
  )
}
