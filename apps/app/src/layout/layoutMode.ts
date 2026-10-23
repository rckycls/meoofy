import { useWindowDimensions } from 'react-native'

export type LayoutMode = 'mobile' | 'mobile-centered' | 'desktop'

/** Content width cap from 768 px up. */
export const CENTERED_MAX_WIDTH = 560

const CENTERED_FROM = 768
const DESKTOP_FROM = 1024

export function layoutModeFor(width: number): LayoutMode {
  if (width >= DESKTOP_FROM) return 'desktop'
  if (width >= CENTERED_FROM) return 'mobile-centered'
  return 'mobile'
}

export function useLayoutMode(): LayoutMode {
  return layoutModeFor(useWindowDimensions().width)
}
