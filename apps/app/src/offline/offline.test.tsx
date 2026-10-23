import { Dimensions, StyleSheet, Text } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'
import {
  createPet,
  getEntitlement,
  getPet,
  getProfile,
  listPets,
  listPhotos,
  type Entitlement,
  type Pet,
  type Profile,
} from '@pawpin/api'
import { cardRoles, colors } from '@pawpin/ui'

import AccountTab from '../../app/(tabs)/account'
import TabsLayout from '../../app/(tabs)/_layout'
import HomeTab from '../../app/(tabs)/home'
import EditPetRoute from '../../app/pets/[id]/edit'
import PetProfileRoute from '../../app/pets/[id]/index'
import PhotosRoute from '../../app/pets/[id]/photos'
import AddPetRoute from '../../app/pets/new'
import { fakeClient } from '../testing/fakeClient'
import { changeConnection, startWithConnection } from '../testing/netInfo'
import { seedPersistedCache } from '../testing/persistedCache'
import { testRootStackLayout } from '../testing/TestRoot'
import { setWindowWidth } from '../testing/window'
import { saveDraft } from './draft'

jest.mock('@pawpin/api', () => ({
  ...jest.requireActual('@pawpin/api'),
  listPets: jest.fn(),
  getPet: jest.fn(),
  getEntitlement: jest.fn(),
  getProfile: jest.fn(),
  createPet: jest.fn(),
  listPhotos: jest.fn(),
  checkSession: jest.fn(async () => 'unknown'),
}))
// jest-expo stubs the native module, so `randomUUID` would return undefined.
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => PET_ID) }))
const mockListPets = jest.mocked(listPets)
const mockGetPet = jest.mocked(getPet)
const mockGetEntitlement = jest.mocked(getEntitlement)
const mockGetProfile = jest.mocked(getProfile)
const mockCreatePet = jest.mocked(createPet)
const mockListPhotos = jest.mocked(listPhotos)

const PET_ID = '2f0c9a64-1b5e-4c6d-8a3f-5d7e9b1c2a40'
const BANNER = 'You’re offline. Saved information is available.'
const DRAFT_KEY = 'pawpin.petDraft'

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
const milo = pet({ id: PET_ID, name: 'Milo', breed: 'Beagle', ageMonths: 38 })
const luna = pet({ id: '3a1d0b75-2c6f-4d7e-9b40-6e8f0c2d3b51', name: 'Luna', species: 'cat' })
const alex: Profile = {
  id: 'u1',
  displayName: 'Alex',
  onboardingPath: 'owner',
  onboardingCompletedAt: '2026-10-01T00:00:00Z',
}
const free2: Entitlement = { tier: 'free', petLimit: 3, activePets: 2 }

/** What an earlier session saved on this device: the pets, the plan and the profile. */
const savedSession = () =>
  seedPersistedCache([
    [['pets'], [milo, luna]],
    [['entitlement'], free2],
    [['profile'], alex],
  ])

function stub(label: string) {
  return function Stub() {
    return <Text>{label}</Text>
  }
}

async function openApp(initialUrl: string) {
  const fake = fakeClient({ userId: 'u1', email: 'alex@example.com' })
  const router = await renderRouter(
    {
      _layout: testRootStackLayout(fake.client),
      '(tabs)/_layout': TabsLayout,
      '(tabs)/home': HomeTab,
      '(tabs)/find': stub('Find screen'),
      '(tabs)/alerts': stub('Alerts screen'),
      '(tabs)/account': AccountTab,
      '(auth)/sign-in': stub('Sign-in screen'),
      plans: stub('Plans screen'),
      'pets/new': AddPetRoute,
      'pets/[id]/index': PetProfileRoute,
      'pets/[id]/edit': EditPetRoute,
      'pets/[id]/photos': PhotosRoute,
    },
    { initialUrl },
  )
  return { router, fake }
}

const button = (name: string | RegExp) => screen.getByRole('button', { name })
const pressButton = (name: string | RegExp) => fireEvent.press(button(name))
const banner = () => screen.queryByRole('status', { name: BANNER })

beforeEach(async () => {
  await AsyncStorage.clear()
  startWithConnection(true)
  mockListPets.mockReset().mockResolvedValue([milo, luna])
  mockGetPet.mockReset().mockResolvedValue(milo)
  mockGetEntitlement.mockReset().mockResolvedValue(free2)
  mockGetProfile.mockReset().mockResolvedValue(alex)
  mockCreatePet.mockReset().mockImplementation(async (_client, input) => ({ ...milo, ...input }))
  mockListPhotos.mockReset().mockResolvedValue([])
})

const initialWindow = Dimensions.get('window')
afterEach(() => setWindowWidth(initialWindow.width, initialWindow.height))

describe('offline (spec §9)', () => {
  it('renders cached pets offline', async () => {
    await savedSession()
    startWithConnection(false)
    const { router } = await openApp('/home')

    expect(await screen.findByText('Milo')).toBeOnTheScreen()
    expect(screen.getByText('Luna')).toBeOnTheScreen()
    expect(screen.getByRole('header', { name: 'Hello, Alex' })).toBeOnTheScreen()
    expect(banner()).toBeOnTheScreen()
    // Nothing was asked of the server: the pets came from the device.
    expect(mockListPets).not.toHaveBeenCalled()

    await pressButton('Add a pet')

    await waitFor(() => expect(router.getPathname()).toBe('/pets/new'))
    const saveDraftButton = await screen.findByRole('button', { name: 'Save as draft' })
    expect(saveDraftButton).toHaveStyle({ backgroundColor: colors.cobalt })
    expect(button('Continue to photos')).toBeDisabled()
    expect(
      screen.getByText(
        'Adding a pet needs a connection. Save a draft now and finish when you’re back online.',
      ),
    ).toBeOnTheScreen()
    // The draft is the first action offered.
    const [firstAction] = screen.getAllByRole('button', {
      name: /^(Save as draft|Continue to photos)$/,
    })
    expect(firstAction).toBe(saveDraftButton)
  })

  it('restores draft after restart', async () => {
    await saveDraft({ name: 'Milo' })
    await openApp('/pets/new')
    await waitFor(() => expect(screen.getByLabelText('Pet’s name').props.value).toBe('Milo'))

    await screen.unmount()
    const { router } = await openApp('/pets/new')

    await waitFor(() => expect(screen.getByLabelText('Pet’s name').props.value).toBe('Milo'))

    await pressButton('Continue to photos')

    await waitFor(() => expect(router.getPathname()).toBe(`/pets/${PET_ID}/photos`))
    expect(mockCreatePet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'Milo' }),
    )
    // The pet exists now, so its draft is gone from the device.
    await act(async () => undefined)
    expect(await AsyncStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it('saves the basics offline as a draft that is still there after a restart', async () => {
    startWithConnection(false)
    await openApp('/pets/new')
    await fireEvent.changeText(await screen.findByLabelText('Pet’s name'), 'Luna')
    await fireEvent.press(screen.getByRole('radio', { name: 'Cat' }))

    await pressButton('Save as draft')

    expect(await screen.findByText(/Draft saved on this device/)).toBeOnTheScreen()
    expect(mockCreatePet).not.toHaveBeenCalled()

    await screen.unmount()
    await openApp('/pets/new')

    await waitFor(() => expect(screen.getByLabelText('Pet’s name').props.value).toBe('Luna'))
    expect(screen.getByRole('radio', { name: 'Cat', checked: true })).toBeOnTheScreen()
  })

  it('disables photo actions offline, and says "Photos need a connection"', async () => {
    await openApp(`/pets/${PET_ID}/photos`)
    expect(await screen.findByRole('button', { name: 'Choose from library' })).toBeEnabled()

    await changeConnection(false)

    expect(screen.getByText('Photos need a connection')).toBeOnTheScreen()
    expect(button('Choose from library')).toBeDisabled()
    expect(button('Take photo')).toBeDisabled()
    // Leaving still works.
    expect(button('Finish later')).toBeEnabled()

    await changeConnection(true)

    expect(button('Choose from library')).toBeEnabled()
    expect(screen.queryByText('Photos need a connection')).toBeNull()
  })

  it('does not claim photos are missing when they could not be loaded offline', async () => {
    await savedSession()
    startWithConnection(false)
    await openApp(`/pets/${PET_ID}/photos`)

    expect(await screen.findByText('Photos need a connection')).toBeOnTheScreen()
    expect(screen.queryByText('Not added yet')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Choose from library' })).toBeNull()
    expect(mockListPhotos).not.toHaveBeenCalled()
  })

  it('shows a cached pet read-only: Edit and Delete wait for a connection, and say so', async () => {
    await savedSession()
    startWithConnection(false)
    await openApp(`/pets/${PET_ID}`)

    expect(await screen.findByRole('header', { name: 'Milo' })).toBeOnTheScreen()
    expect(screen.getByText('Editing and deleting need a connection')).toBeOnTheScreen()
    expect(button('Edit')).toBeDisabled()
    expect(button('Delete pet')).toBeDisabled()
    // The photos screen explains itself.
    expect(button('Add reference photos')).toBeEnabled()
    expect(banner()).toBeOnTheScreen()

    await changeConnection(true)

    expect(button('Edit')).toBeEnabled()
    expect(button('Delete pet')).toBeEnabled()
    expect(screen.queryByText('Editing and deleting need a connection')).toBeNull()
  })

  it('keeps edits on the form offline, with Save changes waiting for a connection', async () => {
    await openApp(`/pets/${PET_ID}/edit`)
    await fireEvent.changeText(await screen.findByLabelText('Breed or description'), 'Basset')

    await changeConnection(false)

    expect(button('Save changes')).toBeDisabled()
    expect(screen.getByText('Saving changes needs a connection')).toBeOnTheScreen()
    expect(screen.getByLabelText('Breed or description').props.value).toBe('Basset')
    // Editing is not adding: there is no draft to save.
    expect(screen.queryByRole('button', { name: 'Save as draft' })).toBeNull()
  })

  it('on Account, keeps Sign out and waits for a connection to change the name or delete', async () => {
    startWithConnection(false)
    await openApp('/account')

    expect(await screen.findByText('alex@example.com')).toBeOnTheScreen()
    expect(button('Sign out')).toBeEnabled()
    expect(button('Delete account')).toBeDisabled()
    expect(screen.getByText('Deleting your account needs a connection')).toBeOnTheScreen()
    expect(button('Edit name')).toBeDisabled()
    expect(screen.getByText('Changing your name needs a connection')).toBeOnTheScreen()
    // Nothing saved and no network: the name says so instead of loading for ever.
    expect(screen.getByText('Not available offline')).toBeOnTheScreen()
    expect(screen.queryByRole('progressbar', { name: 'Loading your name' })).toBeNull()
  })
})

describe('OfflineBanner', () => {
  it('is status text in the attention colours, and goes when the connection is back', async () => {
    await savedSession()
    startWithConnection(false)
    await openApp('/home')

    const status = await screen.findByRole('status', { name: BANNER })
    expect(status).toHaveStyle({ backgroundColor: cardRoles.attention.from })
    expect(within(status).getByText(BANNER)).toHaveStyle({ color: cardRoles.attention.body })

    await changeConnection(true)

    expect(banner()).toBeNull()
    expect(screen.getByText('Milo')).toBeOnTheScreen()
  })

  it('sits at the top of a phone screen, clear of the status bar', async () => {
    setWindowWidth(390, 844)
    await savedSession()
    startWithConnection(false)
    await openApp('/home')

    const status = await screen.findByRole('status', { name: BANNER })
    // TestRoot's safe area has a 47 pt top inset.
    expect(StyleSheet.flatten(status.props.style).paddingTop).toBeGreaterThanOrEqual(47)
  })

  it('sits under the top nav on desktop', async () => {
    setWindowWidth(1440, 1000)
    await savedSession()
    startWithConnection(false)
    await openApp('/home')

    expect(await screen.findByRole('status', { name: BANNER })).toBeOnTheScreen()
    expect(screen.getByTestId('web-nav')).toBeOnTheScreen()
    // The nav comes first on the page, then the banner, then the screen.
    const page = JSON.stringify(screen.toJSON())
    expect(page.indexOf('"web-nav"')).toBeLessThan(page.indexOf(BANNER))
    expect(page.indexOf(BANNER)).toBeLessThan(page.indexOf('Hello, Alex'))
  })

  it('shows on every tab, and not while online', async () => {
    await savedSession()
    await openApp('/home')
    await screen.findByText('Milo')
    expect(banner()).toBeNull()

    await changeConnection(false)
    expect(banner()).toBeOnTheScreen()

    await act(async () => {
      await fireEvent.press(screen.getByRole('tab', { name: 'Account' }))
    })
    expect(await screen.findByText('alex@example.com')).toBeOnTheScreen()
    expect(banner()).toBeOnTheScreen()
  })
})
