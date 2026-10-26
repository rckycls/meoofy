import { Dimensions, StyleSheet, Text } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { router } from 'expo-router'
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'
import { getEntitlement, type Entitlement } from '@meoofy/api'
import { AppError } from '@meoofy/core'

import PlansRoute from '../../../app/plans'
import { fakeClient } from '../../testing/fakeClient'
import { testRootStackLayout } from '../../testing/TestRoot'
import { setWindowWidth } from '../../testing/window'

jest.mock('@meoofy/api', () => ({
  ...jest.requireActual('@meoofy/api'),
  getEntitlement: jest.fn(),
  checkSession: jest.fn(async () => 'unknown'),
}))
const mockGetEntitlement = jest.mocked(getEntitlement)

const entitlement = (tier: Entitlement['tier']): Entitlement => ({
  tier,
  petLimit: tier === 'free' ? 3 : tier === 'pro' ? 10 : null,
  activePets: 2,
})

function stub(label: string) {
  return function Stub() {
    return <Text>{label}</Text>
  }
}

async function open(initialUrl = '/plans') {
  const fake = fakeClient({ userId: 'u1' })
  const router = await renderRouter(
    {
      _layout: testRootStackLayout(fake.client),
      plans: PlansRoute,
      '(tabs)/home': stub('Home screen'),
      'pets/new': stub('Add pet screen'),
    },
    { initialUrl },
  )
  return router
}

/** The card for one tier (its header names it). */
function tierCard(name: string) {
  const card = screen
    .getAllByTestId('card')
    .find((candidate) => within(candidate).queryByRole('header', { name }) !== null)
  if (card === undefined) throw new Error(`no card for ${name}`)
  return within(card)
}

beforeEach(async () => {
  await AsyncStorage.clear()
  mockGetEntitlement.mockReset().mockResolvedValue(entitlement('free'))
})

const initialWindow = Dimensions.get('window')
afterEach(() => setWindowWidth(initialWindow.width, initialWindow.height))

describe('Compare plans', () => {
  it('shows Free 3, Pro 10 and Max unlimited, taken from the plan limits', async () => {
    await open()

    expect(await screen.findByRole('header', { name: 'Compare plans' })).toBeOnTheScreen()
    expect(tierCard('Free').getByText('Up to 3 pets')).toBeOnTheScreen()
    expect(tierCard('Pro').getByText('Up to 10 pets')).toBeOnTheScreen()
    expect(tierCard('Max').getByText('Unlimited pets')).toBeOnTheScreen()
  })

  it('offers no purchase: every upgrade button is disabled and says "Coming soon"', async () => {
    await open()
    await screen.findByText('Up to 3 pets')

    const buttons = screen.getAllByRole('button', { name: 'Coming soon' })
    expect(buttons).toHaveLength(2)
    for (const button of buttons) {
      expect(button).toBeDisabled()
    }
    expect(tierCard('Pro').getByRole('button', { name: 'Coming soon' })).toBeDisabled()
    expect(tierCard('Max').getByRole('button', { name: 'Coming soon' })).toBeDisabled()
  })

  it('does nothing when a disabled upgrade button is pressed', async () => {
    const router = await open()
    await screen.findByText('Up to 3 pets')

    await fireEvent.press(tierCard('Pro').getByRole('button', { name: 'Coming soon' }))

    expect(router.getPathname()).toBe('/plans')
  })

  it('marks the current plan and offers upgrades only above it', async () => {
    await open()
    expect(await screen.findByText('Your plan')).toBeOnTheScreen()

    expect(tierCard('Free').getByText('Your plan')).toBeOnTheScreen()
    expect(tierCard('Free').queryByRole('button')).toBeNull()
    expect(tierCard('Pro').queryByText('Your plan')).toBeNull()
  })

  it('marks Pro as the current plan on Pro, with Max the only upgrade', async () => {
    mockGetEntitlement.mockResolvedValue(entitlement('pro'))
    await open()

    expect(await screen.findByText('Your plan')).toBeOnTheScreen()
    expect(tierCard('Pro').getByText('Your plan')).toBeOnTheScreen()
    expect(tierCard('Free').queryByText('Your plan')).toBeNull()
    expect(tierCard('Free').queryByRole('button')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Coming soon' })).toHaveLength(1)
    expect(tierCard('Max').getByRole('button', { name: 'Coming soon' })).toBeDisabled()
  })

  it('marks Max as the current plan with nothing left to upgrade to', async () => {
    mockGetEntitlement.mockResolvedValue(entitlement('max'))
    await open()

    expect(await screen.findByText('Your plan')).toBeOnTheScreen()
    expect(tierCard('Max').getByText('Your plan')).toBeOnTheScreen()
    expect(screen.queryByRole('button', { name: 'Coming soon' })).toBeNull()
  })

  it('still compares the plans when the current one cannot be read', async () => {
    mockGetEntitlement.mockRejectedValue(new AppError('UNKNOWN'))
    await open()
    await waitFor(() => expect(mockGetEntitlement).toHaveBeenCalled())

    expect(await screen.findByText('Up to 3 pets')).toBeOnTheScreen()
    expect(screen.queryByText('Your plan')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Coming soon' })).toHaveLength(2)
  })

  it('says plainly that nothing can be bought yet', async () => {
    await open()

    expect(
      await screen.findByText('Paid plans aren’t available yet. Every pet you add stays private.'),
    ).toBeOnTheScreen()
  })

  it('goes back to where the person came from', async () => {
    const opened = await open('/home')
    await screen.findByText('Home screen')
    await act(async () => router.push('/plans'))
    await screen.findByRole('header', { name: 'Compare plans' })

    await fireEvent.press(screen.getByRole('button', { name: 'Back' }))

    await waitFor(() => expect(opened.getPathname()).toBe('/home'))
  })

  it('goes Home when it was opened directly, with nothing to go back to', async () => {
    const router = await open('/plans')
    await screen.findByRole('header', { name: 'Compare plans' })

    await fireEvent.press(screen.getByRole('button', { name: 'Back' }))

    await waitFor(() => expect(router.getPathname()).toBe('/home'))
  })

  it('keeps the back control at least 44 pt tall', async () => {
    await open()
    const back = await screen.findByRole('button', { name: 'Back' })

    expect(StyleSheet.flatten(back.props.style).minHeight).toBeGreaterThanOrEqual(44)
  })

  it('stacks the three cards on a phone and sets them side by side from 1024 px', async () => {
    setWindowWidth(390, 844)
    await open()
    await screen.findByText('Up to 3 pets')
    expect(StyleSheet.flatten(screen.getByTestId('plans-tiers').props.style).flexDirection).toBe(
      'column',
    )

    await act(async () => setWindowWidth(1440, 1000))
    await waitFor(() =>
      expect(StyleSheet.flatten(screen.getByTestId('plans-tiers').props.style).flexDirection).toBe(
        'row',
      ),
    )
  })

  it('hides the sticker from screen readers', async () => {
    await open()
    await screen.findByText('Up to 3 pets')

    expect(screen.queryByTestId('sticker-paw-star')).toBeNull()
    expect(
      screen.getByTestId('sticker-paw-star', { includeHiddenElements: true }),
    ).toBeOnTheScreen()
  })
})
