import { Text } from 'react-native'
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library'

import TabsLayout from '../../app/(tabs)/_layout'
import AlertsTab from '../../app/(tabs)/alerts'
import FindTab from '../../app/(tabs)/find'
import { fakeClient } from '../testing/fakeClient'
import { testRootLayout } from '../testing/TestRoot'
import { setWindowWidth } from '../testing/window'
import { navKeyForPath, tabHref } from './tabs'

function routes(client = fakeClient({ userId: 'u1' }).client) {
  return {
    _layout: testRootLayout(client),
    '(tabs)/_layout': TabsLayout,
    '(tabs)/find': FindTab,
    '(tabs)/alerts': AlertsTab,
    '(auth)/sign-in': () => <Text>Sign-in screen</Text>,
  }
}

const FIND_COPY = 'Scanning arrives in the next pilot build'

describe('tab layout', () => {
  it('renders the Find tab above the bottom tab bar at 390 px', async () => {
    setWindowWidth(390, 844)
    await renderRouter(routes(), { initialUrl: '/find' })

    expect(await screen.findByText(FIND_COPY)).toBeOnTheScreen()
    expect(screen.getByTestId('tab-bar')).toBeOnTheScreen()
    expect(screen.queryByTestId('web-nav')).toBeNull()
    expect(screen.getByRole('tab', { name: 'Find' }).props.accessibilityState).toMatchObject({
      selected: true,
    })
  })

  it('keeps the tab bar in the centred layout at 800 px', async () => {
    setWindowWidth(800)
    await renderRouter(routes(), { initialUrl: '/find' })

    expect(await screen.findByText(FIND_COPY)).toBeOnTheScreen()
    expect(screen.getByTestId('tab-bar')).toBeOnTheScreen()
    expect(screen.queryByTestId('web-nav')).toBeNull()
  })

  it('renders the Find tab under the top nav instead of a tab bar at 1440 px', async () => {
    setWindowWidth(1440, 1000)
    await renderRouter(routes(), { initialUrl: '/find' })

    expect(await screen.findByText(FIND_COPY)).toBeOnTheScreen()
    expect(screen.getByTestId('web-nav')).toBeOnTheScreen()
    expect(screen.queryByTestId('tab-bar')).toBeNull()
    expect(screen.getByRole('link', { name: 'Find' }).props.accessibilityState).toMatchObject({
      selected: true,
    })
  })

  it('moves between tabs from the tab bar', async () => {
    setWindowWidth(390, 844)
    const router = await renderRouter(routes(), { initialUrl: '/find' })
    await screen.findByText(FIND_COPY)

    await fireEvent.press(screen.getByRole('tab', { name: 'Alerts' }))

    expect(router.getPathname()).toBe('/alerts')
    expect(await screen.findByText('Alerts arrive in the next pilot build')).toBeOnTheScreen()
    expect(screen.getByRole('tab', { name: 'Alerts' }).props.accessibilityState).toMatchObject({
      selected: true,
    })
  })

  it('moves between tabs from the top nav', async () => {
    setWindowWidth(1440, 1000)
    const router = await renderRouter(routes(), { initialUrl: '/alerts' })
    await screen.findByText('Alerts arrive in the next pilot build')

    await fireEvent.press(screen.getByRole('link', { name: 'Find' }))

    expect(router.getPathname()).toBe('/find')
  })

  it('sends a signed-out visitor to sign-in', async () => {
    setWindowWidth(390, 844)
    const router = await renderRouter(routes(fakeClient({ userId: null }).client), {
      initialUrl: '/find',
    })

    expect(await screen.findByText('Sign-in screen')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/sign-in')
  })
})

describe('tab routes', () => {
  it('maps paths to the selected nav key', () => {
    expect(navKeyForPath('/find')).toBe('find')
    expect(navKeyForPath('/alerts')).toBe('alerts')
    expect(navKeyForPath('/account')).toBe('account')
    expect(navKeyForPath('/home')).toBe('home')
    expect(navKeyForPath('/')).toBe('home')
  })

  it('links every nav key to its tab route', () => {
    expect(tabHref).toEqual({
      home: '/(tabs)/home',
      find: '/(tabs)/find',
      alerts: '/(tabs)/alerts',
      account: '/(tabs)/account',
    })
  })
})
