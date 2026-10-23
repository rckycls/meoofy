import { render, screen } from '@testing-library/react-native'
import { Dimensions, StyleSheet, processColor } from 'react-native'
import { SafeAreaInsetsContext } from 'react-native-safe-area-context'
import { flowTints } from '@pawpin/ui'

import AlertsTab from '../../../app/(tabs)/alerts'
import FindTab from '../../../app/(tabs)/find'
import { setWindowWidth } from '../../testing/window'

// Decorative layers (gradient, glows, stickers) are hidden from assistive
// tech, so queries for them include hidden elements.
const hidden = { includeHiddenElements: true } as const

const initialWindow = Dimensions.get('window')
afterEach(() => setWindowWidth(initialWindow.width))

describe('Find placeholder', () => {
  it('renders the scanning copy on a finder-tinted ScreenShell', async () => {
    await render(<FindTab />)

    expect(screen.getByText('Scanning arrives in the next pilot build')).toBeOnTheScreen()
    const gradient = screen.getByTestId('screen-gradient', hidden)
    expect(gradient.props.colors[0]).toBe(processColor(flowTints.finder.tint))
    expect(screen.getByTestId('glow-a', hidden)).toHaveStyle({
      backgroundColor: flowTints.finder.glowA,
    })
  })

  it('announces the title as a header and hides the sticker', async () => {
    await render(<FindTab />)

    expect(
      screen.getByRole('header', { name: 'Scanning arrives in the next pilot build' }),
    ).toBeOnTheScreen()
    expect(screen.queryByTestId('sticker-paw-pin')).toBeNull()
    expect(screen.getByTestId('sticker-paw-pin', hidden)).toBeOnTheScreen()
  })

  it('leaves the bottom safe area to the tab bar', async () => {
    await render(
      <SafeAreaInsetsContext.Provider value={{ top: 47, right: 0, bottom: 34, left: 0 }}>
        <FindTab />
      </SafeAreaInsetsContext.Provider>,
    )

    // The screen scrolls, so the padding sits on the scroll content.
    const content = StyleSheet.flatten(
      screen.getByTestId('screen-content').props.contentContainerStyle,
    )
    expect(content.paddingTop).toBe(47 + 16)
    expect(content.paddingBottom).toBe(16)
  })

  it('caps the content at 560 px from 768 px wide', async () => {
    setWindowWidth(800)
    await render(<FindTab />)
    expect(screen.getByTestId('content-column')).toHaveStyle({ maxWidth: 560 })
  })

  it('uses the full width on a phone', async () => {
    setWindowWidth(390)
    await render(<FindTab />)
    expect(
      StyleSheet.flatten(screen.getByTestId('content-column').props.style).maxWidth,
    ).toBeUndefined()
  })
})

describe('Alerts placeholder', () => {
  it('renders its own copy on a recovery-tinted ScreenShell', async () => {
    await render(<AlertsTab />)

    expect(screen.getByText('Alerts arrive in the next pilot build')).toBeOnTheScreen()
    const gradient = screen.getByTestId('screen-gradient', hidden)
    expect(gradient.props.colors[0]).toBe(processColor(flowTints.recovery.tint))
  })
})
