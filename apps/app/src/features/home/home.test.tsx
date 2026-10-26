import { Dimensions, StyleSheet, Text, processColor } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { onlineManager, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'
import {
  getEntitlement,
  getProfile,
  listPets,
  type Entitlement,
  type Pet,
  type Profile,
} from '@meoofy/api'
import { AppError } from '@meoofy/core'
import { cardRoles, flowTints } from '@meoofy/ui'

import HomeTab from '../../../app/(tabs)/home'
import { fakeClient } from '../../testing/fakeClient'
import { testRootLayout } from '../../testing/TestRoot'
import { setWindowWidth } from '../../testing/window'

jest.mock('@meoofy/api', () => ({
  ...jest.requireActual('@meoofy/api'),
  listPets: jest.fn(),
  getEntitlement: jest.fn(),
  getProfile: jest.fn(),
  checkSession: jest.fn(async () => 'unknown'),
}))
const mockListPets = jest.mocked(listPets)
const mockGetEntitlement = jest.mocked(getEntitlement)
const mockGetProfile = jest.mocked(getProfile)

const alex: Profile = {
  id: 'u1',
  displayName: 'Alex',
  onboardingPath: 'owner',
  onboardingCompletedAt: '2026-10-01T00:00:00Z',
}

function pet(fields: Partial<Pet> & Pick<Pet, 'id' | 'name'>): Pet {
  return {
    species: 'dog',
    breed: null,
    ageMonths: null,
    registrationState: 'private',
    discoveryEnabled: false,
    createdAt: '2026-10-01T00:00:00Z',
    ...fields,
  }
}

const milo = pet({ id: 'p1', name: 'Milo', species: 'dog', breed: 'Beagle', ageMonths: 38 })
const luna = pet({ id: 'p2', name: 'Luna', species: 'cat', ageMonths: 8 })
const rex = pet({ id: 'p3', name: 'Rex' })

const free = (activePets: number): Entitlement => ({ tier: 'free', petLimit: 3, activePets })

function stub(label: string) {
  return function Stub() {
    return <Text>{label}</Text>
  }
}

let queryClient: QueryClient | null = null

function HomeWithCache() {
  queryClient = useQueryClient()
  return <HomeTab />
}

async function open() {
  queryClient = null
  const fake = fakeClient({ userId: 'u1', email: 'alex@example.com' })
  const router = await renderRouter(
    {
      _layout: testRootLayout(fake.client),
      '(tabs)/home': HomeWithCache,
      plans: stub('Plans screen'),
      'pets/new': stub('Add pet screen'),
      'pets/[id]/index': stub('Pet profile screen'),
    },
    { initialUrl: '/home' },
  )
  return { router, fake }
}

const pressButton = (name: string) => fireEvent.press(screen.getByRole('button', { name }))

beforeEach(async () => {
  await AsyncStorage.clear()
  mockListPets.mockReset().mockResolvedValue([milo, luna])
  mockGetEntitlement.mockReset().mockResolvedValue(free(2))
  mockGetProfile.mockReset().mockResolvedValue(alex)
})

const initialWindow = Dimensions.get('window')
afterEach(() => {
  onlineManager.setOnline(true)
  setWindowWidth(initialWindow.width, initialWindow.height)
})

describe('O02 Home', () => {
  it('greets the person and lists their pets as private, with the plan count', async () => {
    await open()

    expect(await screen.findByRole('header', { name: 'Hello, Alex' })).toBeOnTheScreen()
    expect(screen.getByText('Milo')).toBeOnTheScreen()
    expect(screen.getByText('Luna')).toBeOnTheScreen()
    expect(screen.getAllByText('Private')).toHaveLength(2)
    expect(await screen.findByText('2 of 3 · Free')).toBeOnTheScreen()
    expect(screen.queryByText('Your circle starts here')).toBeNull()
  })

  it('describes each pet by species, breed and age so no sticker has to say it', async () => {
    await open()

    expect(await screen.findByText('Dog · Beagle · 3 years 2 months')).toBeOnTheScreen()
    expect(screen.getByText('Cat · 8 months')).toBeOnTheScreen()
  })

  it('hides the pet portraits from screen readers', async () => {
    await open()
    await screen.findByText('Milo')

    expect(screen.queryByTestId('sticker-dog')).toBeNull()
    expect(screen.getByTestId('sticker-dog', { includeHiddenElements: true })).toBeOnTheScreen()
  })

  it('opens a pet from its row', async () => {
    const { router } = await open()
    await screen.findByText('Luna')

    await fireEvent.press(screen.getByRole('button', { name: /Luna/ }))

    await waitFor(() => expect(router.getPathname()).toBe('/pets/p2'))
  })

  it('keeps every pet row at least 44 pt tall', async () => {
    await open()
    const row = await screen.findByRole('button', { name: /Milo/ })

    expect(StyleSheet.flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(44)
  })

  it('"Add a pet" opens the add-pet form while there is room on the plan', async () => {
    const { router } = await open()
    await screen.findByText('2 of 3 · Free')

    await pressButton('Add a pet')

    await waitFor(() => expect(router.getPathname()).toBe('/pets/new'))
  })

  it('"Add a pet" opens Compare plans instead once Free has its 3 pets, and says why', async () => {
    mockListPets.mockResolvedValue([milo, luna, rex])
    mockGetEntitlement.mockResolvedValue(free(3))
    const { router } = await open()
    expect(await screen.findByText('3 of 3 · Free')).toBeOnTheScreen()
    expect(
      screen.getByText(
        'You’ve added 3 pets, the most the Free plan allows. Compare plans to add more.',
      ),
    ).toBeOnTheScreen()

    await pressButton('Add a pet')

    await waitFor(() => expect(router.getPathname()).toBe('/plans'))
  })

  it('counts the limit from the plan: Pro is full at 10', async () => {
    mockGetEntitlement.mockResolvedValue({ tier: 'pro', petLimit: 10, activePets: 10 })
    const { router } = await open()
    expect(await screen.findByText('10 of 10 · Pro')).toBeOnTheScreen()

    await pressButton('Add a pet')

    await waitFor(() => expect(router.getPathname()).toBe('/plans'))
  })

  it('never blocks Max, which has no pet limit', async () => {
    mockGetEntitlement.mockResolvedValue({ tier: 'max', petLimit: null, activePets: 12 })
    const { router } = await open()
    expect(await screen.findByText('12 pets · Max, unlimited')).toBeOnTheScreen()

    await pressButton('Add a pet')

    await waitFor(() => expect(router.getPathname()).toBe('/pets/new'))
  })

  it('links the plan count to Compare plans', async () => {
    const { router } = await open()
    await screen.findByText('2 of 3 · Free')

    await pressButton('Compare plans')

    await waitFor(() => expect(router.getPathname()).toBe('/plans'))
  })

  it('still lets the person add a pet while their plan is unknown, and the server decides', async () => {
    mockGetEntitlement.mockRejectedValue(new AppError('UNKNOWN'))
    const { router } = await open()
    await screen.findByText('Milo')
    await waitFor(() => expect(mockGetEntitlement).toHaveBeenCalled())

    expect(screen.queryByText(/ · Free$/)).toBeNull()
    await pressButton('Add a pet')

    await waitFor(() => expect(router.getPathname()).toBe('/pets/new'))
  })

  it('greets without a name when the profile cannot be read', async () => {
    mockGetProfile.mockRejectedValue(new AppError('UNKNOWN'))
    await open()

    expect(await screen.findByText('Milo')).toBeOnTheScreen()
    await waitFor(() => expect(mockGetProfile).toHaveBeenCalled())
    expect(screen.getByRole('header', { name: 'Hello' })).toBeOnTheScreen()
  })

  it('shows a progress indicator while the pets load', async () => {
    mockListPets.mockReturnValue(new Promise(() => undefined))
    await open()

    expect(await screen.findByRole('progressbar', { name: 'Loading your pets' })).toBeOnTheScreen()
    expect(screen.queryByText('Your circle starts here')).toBeNull()
  })

  it('explains a failed load in plain words and tries again', async () => {
    mockListPets.mockRejectedValueOnce(new AppError('UNKNOWN'))
    await open()

    const note = await screen.findByText('We couldn’t load your pets. Please try again.')
    expect(note).toBeOnTheScreen()
    expect(screen.queryByText('Your circle starts here')).toBeNull()

    await pressButton('Try again')

    expect(await screen.findByText('Milo')).toBeOnTheScreen()
    expect(screen.queryByText('We couldn’t load your pets. Please try again.')).toBeNull()
  })

  it('says so when the device is offline and nothing was saved', async () => {
    onlineManager.setOnline(false)
    await open()

    expect(
      await screen.findByText('You seem to be offline. Check your connection and try again.'),
    ).toBeOnTheScreen()
    expect(mockListPets).not.toHaveBeenCalled()
  })

  it('keeps showing the pets it has when a refresh fails', async () => {
    await open()
    await screen.findByText('Milo')

    mockListPets.mockClear().mockRejectedValue(new AppError('UNKNOWN'))
    await act(async () => {
      await queryClient?.invalidateQueries({ queryKey: ['pets'] })
    })

    expect(mockListPets).toHaveBeenCalled()
    expect(screen.getByText('Milo')).toBeOnTheScreen()
    expect(screen.queryByText('We couldn’t load your pets. Please try again.')).toBeNull()
  })
})

describe('S01 empty registry', () => {
  beforeEach(() => {
    mockListPets.mockResolvedValue([])
    mockGetEntitlement.mockResolvedValue(free(0))
  })

  it('invites the first pet', async () => {
    await open()

    expect(await screen.findByRole('header', { name: 'Your circle starts here' })).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Add my first pet' })).toBeOnTheScreen()
    expect(screen.getByRole('header', { name: 'Hello, Alex' })).toBeOnTheScreen()
    expect(screen.queryByRole('button', { name: 'Add a pet' })).toBeNull()
    expect(screen.queryByText('Private')).toBeNull()
  })

  it('"Add my first pet" opens the add-pet form', async () => {
    const { router } = await open()
    await screen.findByText('Your circle starts here')

    await pressButton('Add my first pet')

    await waitFor(() => expect(router.getPathname()).toBe('/pets/new'))
  })

  it('is drawn on the warm resilience tint, in a celebration card (board 05)', async () => {
    await open()
    await screen.findByText('Your circle starts here')

    const gradient = screen.getByTestId('screen-gradient', { includeHiddenElements: true })
    expect(gradient.props.colors[0]).toBe(processColor(flowTints.resilience.tint))
    expect(screen.getByTestId('card-gradient').props.colors[0]).toBe(
      processColor(cardRoles.celebration.from),
    )
  })

  it('goes back to the owner tint once there is a pet', async () => {
    mockListPets.mockResolvedValue([milo])
    mockGetEntitlement.mockResolvedValue(free(1))
    await open()
    await screen.findByText('Milo')

    const gradient = screen.getByTestId('screen-gradient', { includeHiddenElements: true })
    expect(gradient.props.colors[0]).toBe(processColor(flowTints.owner.tint))
  })

  it('hides its stickers from screen readers', async () => {
    await open()
    await screen.findByText('Your circle starts here')

    expect(screen.queryByTestId('sticker-dog')).toBeNull()
    expect(screen.queryByTestId('sticker-cat')).toBeNull()
    expect(screen.getByTestId('sticker-dog', { includeHiddenElements: true })).toBeOnTheScreen()
  })
})

describe('layout', () => {
  it('stacks everything in one column on a phone, with the plan as a line', async () => {
    setWindowWidth(390, 844)
    await open()
    await screen.findByText('Milo')

    expect(screen.queryByTestId('home-side')).toBeNull()
    expect(screen.getByText('2 of 3 · Free')).toBeOnTheScreen()
    expect(screen.queryByText('Free · 2 of 3 pets')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Add a pet' })).toHaveLength(1)
  })

  it('tints the screen for the owner flow', async () => {
    await open()
    await screen.findByText('Milo')

    const gradient = screen.getByTestId('screen-gradient', { includeHiddenElements: true })
    expect(gradient.props.colors[0]).toBe(processColor(flowTints.owner.tint))
    expect(screen.getByTestId('glow-a', { includeHiddenElements: true })).toHaveStyle({
      backgroundColor: flowTints.owner.glowA,
    })
  })

  it('is the two-column W06 dashboard from 1024 px: pets and greeting, then the plan card', async () => {
    setWindowWidth(1440, 1000)
    await open()
    await screen.findByText('Milo')

    const columns = screen.getByTestId('home-columns')
    expect(StyleSheet.flatten(columns.props.style).flexDirection).toBe('row')

    const main = within(screen.getByTestId('home-main'))
    expect(main.getByRole('header', { name: 'Hello, Alex' })).toBeOnTheScreen()
    expect(main.getByText('Milo')).toBeOnTheScreen()
    expect(main.getByText('Luna')).toBeOnTheScreen()

    const side = within(screen.getByTestId('home-side'))
    expect(side.getByText('Free · 2 of 3 pets')).toBeOnTheScreen()
    expect(side.getByRole('button', { name: 'Add a pet' })).toBeOnTheScreen()
    expect(side.getByRole('button', { name: 'Compare plans' })).toBeOnTheScreen()
    expect(main.queryByRole('button', { name: 'Add a pet' })).toBeNull()
    expect(screen.queryByText('2 of 3 · Free')).toBeNull()
  })

  it('draws the desktop plan card in the community colours with a paw-star sticker (board 07)', async () => {
    setWindowWidth(1440, 1000)
    await open()
    const side = within(await screen.findByTestId('home-side'))

    expect(side.getByTestId('card-gradient').props.colors[0]).toBe(
      processColor(cardRoles.community.from),
    )
    expect(side.getByTestId('sticker-paw-star', { includeHiddenElements: true })).toBeOnTheScreen()
  })

  it('opens Compare plans from the desktop plan card, and Add a pet follows the limit', async () => {
    setWindowWidth(1440, 1000)
    mockListPets.mockResolvedValue([milo, luna, rex])
    mockGetEntitlement.mockResolvedValue(free(3))
    const { router } = await open()
    const side = within(await screen.findByTestId('home-side'))
    expect(await screen.findByText('Free · 3 of 3 pets')).toBeOnTheScreen()

    await fireEvent.press(side.getByRole('button', { name: 'Add a pet' }))

    await waitFor(() => expect(router.getPathname()).toBe('/plans'))
  })

  it('keeps the desktop empty state to one call to action', async () => {
    setWindowWidth(1440, 1000)
    mockListPets.mockResolvedValue([])
    mockGetEntitlement.mockResolvedValue(free(0))
    await open()

    expect(await screen.findByText('Your circle starts here')).toBeOnTheScreen()
    expect(
      within(screen.getByTestId('home-side')).getByText('Free · 0 of 3 pets'),
    ).toBeOnTheScreen()
    expect(screen.getAllByRole('button', { name: /Add (my first|a) pet/ })).toHaveLength(1)
  })
})
