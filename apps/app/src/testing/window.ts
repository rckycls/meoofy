import { Dimensions } from 'react-native'

/** Resizes the test window; `useWindowDimensions` subscribers re-render. */
export function setWindowWidth(width: number, height = 900): void {
  const metrics = { width, height, scale: 2, fontScale: 1 }
  Dimensions.set({ window: metrics, screen: metrics })
}
