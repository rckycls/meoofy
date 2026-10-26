import type { ComponentType } from 'react'
import { Dimensions, StyleSheet, Text, processColor } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { onlineManager, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { randomUUID } from 'expo-crypto'
import { router as appRouter } from 'expo-router'
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'
import { createPet, deletePet, getPet, updatePet, type Pet } from '@meoofy/api'
import { AppError, LIMITS } from '@meoofy/core'
import { cardRoles, colors, flowTints } from '@meoofy/ui'

import TabsLayout from '../../../app/(tabs)/_layout'
import AddPetRoute from '../../../app/pets/new'
import EditPetRoute from '../../../app/pets/[id]/edit'
import PetProfileRoute from '../../../app/pets/[id]/index'
import { env } from '../../env'
import { clearDraft, loadDraft, saveDraft, type PetDraft } from '../../offline/draft'
import { fakeClient } from '../../testing/fakeClient'
import { sentryReports, turnSentryOff } from '../../testing/sentry'
import { testRootStackLayout } from '../../testing/TestRoot'
import { setWindowWidth } from '../../testing/window'

jest.mock('@meoofy/api', () => ({
  ...jest.requireActual('@meoofy/api'),
  createPet: jest.fn(),
  getPet: jest.fn(),
  updatePet: jest.fn(),
  deletePet: jest.fn(),
  checkSession: jest.fn(async () => 'unknown'),
}))
// jest-expo stubs the native module, so `randomUUID` would return undefined.
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }))
// The draft's storage is tested in src/offline; here the form's calls are what matters.
jest.mock('../../offline/draft', () => ({
  saveDraft: jest.fn(async () => undefined),
  loadDraft: jest.fn(async () => null),
  clearDraft: jest.fn(async () => undefined),
}))
const mockCreatePet = jest.mocked(createPet)
const mockGetPet = jest.mocked(getPet)
const mockUpdatePet = jest.mocked(updatePet)
const mockDeletePet = jest.mocked(deletePet)
const mockSaveDraft = jest.mocked(saveDraft)
const mockLoadDraft = jest.mocked(loadDraft)
const mockClearDraft = jest.mocked(clearDraft)
const mockRandomUUID = jest.mocked(randomUUID)

const PET_ID = '2f0c9a64-1b5e-4c6d-8a3f-5d7e9b1c2a40'
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function makePet(fields: Partial<Pet> = {}): Pet {
  return {
    id: PET_ID,
    name: 'Milo',
    species: 'dog',
    breed: 'Golden retriever',
    ageMonths: 36,
    registrationState: 'private',
    discoveryEnabled: false,
    createdAt: '2026-10-01T00:00:00Z',
    ...fields,
  }
}
const milo = makePet()

let fake: ReturnType<typeof fakeClient>
let queryClient: QueryClient | null = null
/** Pets written to the cache before a screen renders, to prove a screen opens from it. */
let cachedPets: Pet[] | null = null

function withCache(Screen: ComponentType) {
  return function WithCache() {
    const client = useQueryClient()
    if (queryClient !== client) {
      queryClient = client
      // The app retries a network failure three times with a backoff; a test shouldn't wait for it.
      client.setQueryDefaults(['pet'], { retry: false })
      if (cachedPets !== null) client.setQueryData(['pets'], cachedPets)
    }
    return <Screen />
  }
}

function stub(label: string) {
  return function Stub() {
    return <Text>{label}</Text>
  }
}

async function open(url: string, { signedIn = true } = {}) {
  queryClient = null
  fake = fakeClient({ userId: signedIn ? 'u1' : null, email: 'alex@example.com' })
  return renderRouter(
    {
      _layout: testRootStackLayout(fake.client),
      '(tabs)/home': stub('Home screen'),
      '(auth)/sign-in': stub('Sign-in screen'),
      plans: stub('Plans screen'),
      'pets/new': withCache(AddPetRoute),
      'pets/[id]/index': withCache(PetProfileRoute),
      'pets/[id]/edit': withCache(EditPetRoute),
      'pets/[id]/photos': stub('Photos screen'),
    },
    { initialUrl: url },
  )
}

const pressButton = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }))
const field = (label: string) => screen.getByLabelText(label)

/** Fills the add-pet form with Milo's details (the species stays at its default). */
async function fillMilo() {
  await fireEvent.changeText(field('Pet’s name'), 'Milo')
  await fireEvent.changeText(field('Breed or description'), 'Golden retriever')
  await fireEvent.changeText(field('Years'), '3')
}

/**
 * Two presses before React can re-render in between, so only the screen's ref guard (not a button
 * it has already disabled) can stop the second. Doing that overlaps two `act` scopes, which React
 * reports on the console; that one message is swallowed and anything else still shows.
 */
async function pressTwiceInOneTick(button: ReturnType<typeof screen.getByRole>) {
  const report = console.error.bind(console)
  const spy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (!String(args[0]).includes('overlapping act() calls')) report(...args)
  })
  try {
    await act(async () => {
      void fireEvent.press(button)
      void fireEvent.press(button)
    })
  } finally {
    spy.mockRestore()
  }
}

let uuidCount = 0
beforeEach(async () => {
  await AsyncStorage.clear()
  cachedPets = null
  uuidCount = 0
  mockRandomUUID.mockReset().mockImplementation(() => uuid(++uuidCount))
  mockCreatePet.mockReset().mockImplementation(async (_client, input) => makePet({ id: input.id }))
  mockGetPet.mockReset().mockResolvedValue(milo)
  mockUpdatePet.mockReset().mockResolvedValue(milo)
  mockDeletePet.mockReset().mockResolvedValue(undefined)
  mockSaveDraft.mockClear()
  mockLoadDraft.mockReset().mockResolvedValue(null)
  mockClearDraft.mockClear()
})

const initialWindow = Dimensions.get('window')
afterEach(() => {
  onlineManager.setOnline(true)
  Object.assign(env.flags, { reportMissing: false })
  turnSentryOff()
  setWindowWidth(initialWindow.width, initialWindow.height)
})

describe('O03 Let’s meet your pet', () => {
  it('asks for the basics, with dog selected and the privacy promise in view', async () => {
    await open('/pets/new')

    expect(await screen.findByRole('header', { name: 'Let’s meet your pet' })).toBeOnTheScreen()
    expect(screen.getByText('Step 1 of 3 · Basics')).toBeOnTheScreen()
    expect(field('Pet’s name')).toBeOnTheScreen()
    expect(field('Breed or description')).toBeOnTheScreen()
    expect(field('Years')).toBeOnTheScreen()
    expect(field('Months')).toBeOnTheScreen()
    expect(screen.getByRole('radio', { name: 'Dog', checked: true })).toBeOnTheScreen()
    expect(screen.getByRole('radio', { name: 'Cat', checked: false })).toBeOnTheScreen()
    expect(screen.getByRole('header', { name: 'Only you can see this' })).toBeOnTheScreen()
    expect(
      screen.getByText('Registration never makes a pet publicly searchable.'),
    ).toBeOnTheScreen()
    expect(mockCreatePet).not.toHaveBeenCalled()
  })

  it('puts the privacy shield sticker on the promise (board 01), hidden from screen readers', async () => {
    await open('/pets/new')
    await screen.findByRole('header', { name: 'Only you can see this' })

    expect(screen.queryByTestId('sticker-privacy-shield')).toBeNull()
    expect(
      screen.getByTestId('sticker-privacy-shield', { includeHiddenElements: true }),
    ).toBeOnTheScreen()
  })

  it('asks for a name, and makes no API call, when it is empty', async () => {
    await open('/pets/new')
    await screen.findByRole('header', { name: 'Let’s meet your pet' })
    await fireEvent.changeText(field('Pet’s name'), '   ')

    await pressButton('Continue to photos')

    expect(await screen.findByText('Give your pet a name')).toBeOnTheScreen()
    expect(field('Pet’s name').props.accessibilityHint).toBe('Give your pet a name')
    expect(mockCreatePet).not.toHaveBeenCalled()
  })

  it('refuses ages over 30 years, and makes no API call', async () => {
    await open('/pets/new')
    await screen.findByRole('header', { name: 'Let’s meet your pet' })
    await fireEvent.changeText(field('Pet’s name'), 'Milo')
    await fireEvent.changeText(field('Years'), String(LIMITS.ageYearsMax + 1))

    await pressButton('Continue to photos')

    expect(await screen.findByText('Age must be 30 years or less')).toBeOnTheScreen()
    expect(field('Years').props.accessibilityHint).toBe('Age must be 30 years or less')
    expect(mockCreatePet).not.toHaveBeenCalled()
  })

  it('refuses a total age over the limit, such as 30 years and 1 month', async () => {
    await open('/pets/new')
    await screen.findByRole('header', { name: 'Let’s meet your pet' })
    await fireEvent.changeText(field('Pet’s name'), 'Milo')
    await fireEvent.changeText(field('Years'), String(LIMITS.ageYearsMax))
    await fireEvent.changeText(field('Months'), '1')

    await pressButton('Continue to photos')

    expect(await screen.findByText('Age must be 30 years or less')).toBeOnTheScreen()
    expect(mockCreatePet).not.toHaveBeenCalled()
  })

  it('names the field that is wrong: months, breed length, and not a number', async () => {
    await open('/pets/new')
    await screen.findByRole('header', { name: 'Let’s meet your pet' })
    await fireEvent.changeText(field('Pet’s name'), 'Milo')
    await fireEvent.changeText(field('Breed or description'), 'x'.repeat(LIMITS.breedMax + 1))
    await fireEvent.changeText(field('Years'), '2.5')
    await fireEvent.changeText(field('Months'), '12')

    await pressButton('Continue to photos')

    expect(await screen.findByText('Use 80 characters or fewer')).toBeOnTheScreen()
    expect(screen.getByText('Enter whole years, like 3')).toBeOnTheScreen()
    expect(screen.getByText('Enter whole months, fewer than a full year')).toBeOnTheScreen()
    expect(mockCreatePet).not.toHaveBeenCalled()
  })

  it('clears a field’s error as soon as it is edited', async () => {
    await open('/pets/new')
    await screen.findByRole('header', { name: 'Let’s meet your pet' })
    await pressButton('Continue to photos')
    expect(await screen.findByText('Give your pet a name')).toBeOnTheScreen()

    await fireEvent.changeText(field('Pet’s name'), 'M')

    expect(screen.queryByText('Give your pet a name')).toBeNull()
  })

  it('adds the pet, then clears the draft, refreshes the pets and plan and opens the photos step', async () => {
    const router = await open('/pets/new')
    await screen.findByRole('header', { name: 'Let’s meet your pet' })
    queryClient?.setQueryData(['pets'], [])
    queryClient?.setQueryData(['entitlement'], { tier: 'free', petLimit: 3, activePets: 0 })
    await fillMilo()

    await pressButton('Continue to photos')

    await waitFor(() =>
      expect(mockCreatePet).toHaveBeenCalledWith(fake.client, {
        id: uuid(1),
        name: 'Milo',
        species: 'dog',
        breed: 'Golden retriever',
        ageMonths: 36,
      }),
    )
    await waitFor(() => expect(router.getPathname()).toBe(`/pets/${uuid(1)}/photos`))
    expect(mockClearDraft).toHaveBeenCalledTimes(1)
    expect(queryClient?.getQueryState(['pets'])?.isInvalidated).toBe(true)
    expect(queryClient?.getQueryState(['entitlement'])?.isInvalidated).toBe(true)
  })

  it('sends the chosen species, trimmed text, and months added to the years', async () => {
    await open('/pets/new')
    await screen.findByRole('header', { name: 'Let’s meet your pet' })
    await fireEvent.changeText(field('Pet’s name'), '  Luna ')
    await fireEvent.press(screen.getByRole('radio', { name: 'Cat' }))
    await fireEvent.changeText(field('Months'), '8')

    await pressButton('Continue to photos')

    await waitFor(() =>
      expect(mockCreatePet).toHaveBeenCalledWith(fake.client, {
        id: uuid(1),
        name: 'Luna',
        species: 'cat',
        breed: null,
        ageMonths: 8,
      }),
    )
  })

  it('sends no age when both age fields are empty', async () => {
    await open('/pets/new')
    await screen.findByRole('header', { name: 'Let’s meet your pet' })
    await fireEvent.changeText(field('Pet’s name'), 'Milo')

    await pressButton('Continue to photos')

    await waitFor(() =>
      expect(mockCreatePet).toHaveBeenCalledWith(
        fake.client,
        expect.objectContaining({ breed: null, ageMonths: null }),
      ),
    )
  })

  it('retries with the same id after a failure, so the server creates the pet once', async () => {
    mockCreatePet.mockRejectedValueOnce(new AppError('NETWORK'))
    const router = await open('/pets/new')
    await screen.findByRole('header', { name: 'Let’s meet your pet' })
    await fillMilo()

    await pressButton('Continue to photos')

    expect(
      await screen.findByText('You seem to be offline. Check your connection and try again.'),
    ).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/pets/new')
    expect(mockClearDraft).not.toHaveBeenCalled()
    // What was typed is still there.
    expect(field('Pet’s name').props.value).toBe('Milo')

    await pressButton('Continue to photos')

    await waitFor(() => expect(router.getPathname()).toBe(`/pets/${uuid(1)}/photos`))
    expect(mockCreatePet).toHaveBeenCalledTimes(2)
    expect(mockCreatePet.mock.calls[0]?.[1].id).toBe(uuid(1))
    expect(mockCreatePet.mock.calls[1]?.[1].id).toBe(uuid(1))
    expect(mockRandomUUID).toHaveBeenCalledTimes(1)
  })

  it('makes a new id for a new form', async () => {
    const router = await open('/pets/new')
    await screen.findByRole('header', { name: 'Let’s meet your pet' })
    await fireEvent.changeText(field('Pet’s name'), 'Milo')
    await pressButton('Continue to photos')
    await waitFor(() => expect(router.getPathname()).toBe(`/pets/${uuid(1)}/photos`))

    await act(async () => appRouter.push('/pets/new'))
    await fireEvent.changeText(await screen.findByLabelText('Pet’s name'), 'Luna')
    await pressButton('Continue to photos')

    await waitFor(() => expect(router.getPathname()).toBe(`/pets/${uuid(2)}/photos`))
    expect(mockCreatePet.mock.calls.map(([, input]) => input.id)).toEqual([uuid(1), uuid(2)])
  })

  it('adds the pet once however fast the button is pressed', async () => {
    mockCreatePet.mockImplementation(() => new Promise(() => undefined))
    await open('/pets/new')
    await screen.findByRole('header', { name: 'Let’s meet your pet' })
    await fireEvent.changeText(field('Pet’s name'), 'Milo')

    await pressTwiceInOneTick(screen.getByRole('button', { name: 'Continue to photos' }))

    expect(mockCreatePet).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Continue to photos' })).toBeDisabled()
  })

  it('does not open the next step if the person has gone back while the pet was being added', async () => {
    let finish: (pet: Pet) => void = () => undefined
    mockCreatePet.mockReturnValue(new Promise<Pet>((resolve) => (finish = resolve)))
    const router = await open('/pets/new')
    await screen.findByRole('header', { name: 'Let’s meet your pet' })
    await fireEvent.changeText(field('Pet’s name'), 'Milo')
    await pressButton('Continue to photos')
    await pressButton('Back')
    await waitFor(() => expect(router.getPathname()).toBe('/home'))

    await act(async () => finish(makePet({ id: uuid(1) })))

    expect(router.getPathname()).toBe('/home')
    // The pet was still added, so the draft is gone and the lists refresh.
    expect(mockClearDraft).toHaveBeenCalledTimes(1)
  })

  it('offline, offers the draft first and waits for a connection to add the pet', async () => {
    onlineManager.setOnline(false)
    await open('/pets/new')
    await screen.findByRole('header', { name: 'Let’s meet your pet' })
    await fireEvent.changeText(field('Pet’s name'), 'Milo')

    expect(screen.getByRole('button', { name: 'Save as draft' })).toHaveStyle({
      backgroundColor: colors.cobalt,
    })
    expect(screen.getByRole('button', { name: 'Continue to photos' })).toBeDisabled()
    expect(
      screen.getByText(
        'Adding a pet needs a connection. Save a draft now and finish when you’re back online.',
      ),
    ).toBeOnTheScreen()

    await act(async () => onlineManager.setOnline(true))

    expect(screen.getByRole('button', { name: 'Continue to photos' })).toBeEnabled()
    await pressButton('Continue to photos')
    await waitFor(() => expect(mockCreatePet).toHaveBeenCalledTimes(1))
  })

  it('explains the Free 3-pet limit in a community card, and links to Compare plans', async () => {
    mockCreatePet.mockRejectedValue(new AppError('PET_LIMIT_REACHED'))
    const router = await open('/pets/new')
    await screen.findByRole('header', { name: 'Let’s meet your pet' })
    await fillMilo()

    await pressButton('Continue to photos')

    const note = await screen.findByTestId('pet-limit')
    expect(note.props.role).toBe('alert')
    expect(within(note).getByRole('header', { name: 'Free plan limit reached' })).toBeOnTheScreen()
    expect(
      within(note).getByText('You’ve added 3 pets, the most the Free plan allows.'),
    ).toBeOnTheScreen()
    expect(within(note).getByTestId('card-gradient').props.colors[0]).toBe(
      processColor(cardRoles.community.from),
    )
    expect(router.getPathname()).toBe('/pets/new')

    await fireEvent.press(within(note).getByRole('button', { name: 'Compare plans' }))

    await waitFor(() => expect(router.getPathname()).toBe('/plans'))
  })

  it('says something friendly for any other failure, and keeps the form', async () => {
    const reports = sentryReports()
    mockCreatePet.mockRejectedValue(new AppError('UNKNOWN', 'Failing row contains (Milo)'))
    await open('/pets/new')
    await screen.findByRole('header', { name: 'Let’s meet your pet' })
    await fillMilo()

    await pressButton('Continue to photos')

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeOnTheScreen()
    expect(screen.queryByTestId('pet-limit')).toBeNull()
    expect(screen.getByRole('button', { name: 'Continue to photos' })).toBeEnabled()
    // Unexpected, so it is reported once (spec §9), named and without its message.
    expect(reports()).toEqual(['UNKNOWN in createPet'])
  })

  it('shows a server refusal of the details as a note to check them', async () => {
    mockCreatePet.mockRejectedValue(new AppError('VALIDATION'))
    await open('/pets/new')
    await screen.findByRole('header', { name: 'Let’s meet your pet' })
    await fillMilo()

    await pressButton('Continue to photos')

    expect(
      await screen.findByText('Please check the details above and try again.'),
    ).toBeOnTheScreen()
  })
})

describe('Save as draft', () => {
  it('keeps what was typed on the device, and says so', async () => {
    await open('/pets/new')
    await screen.findByRole('header', { name: 'Let’s meet your pet' })
    await fireEvent.changeText(field('Pet’s name'), 'Mil')
    await fireEvent.press(screen.getByRole('radio', { name: 'Cat' }))
    await fireEvent.changeText(field('Years'), '3')

    await pressButton('Save as draft')

    await waitFor(() =>
      expect(mockSaveDraft).toHaveBeenCalledWith({
        name: 'Mil',
        species: 'cat',
        breed: '',
        years: '3',
        months: '',
      }),
    )
    expect(await screen.findByText(/Draft saved on this device/)).toBeOnTheScreen()
    expect(mockCreatePet).not.toHaveBeenCalled()

    // The note is about what was saved; more typing makes it out of date.
    await fireEvent.changeText(field('Pet’s name'), 'Milo')
    expect(screen.queryByText(/Draft saved on this device/)).toBeNull()
  })

  it('saves a draft that is not valid yet, such as an empty name', async () => {
    await open('/pets/new')
    await screen.findByRole('header', { name: 'Let’s meet your pet' })

    await pressButton('Save as draft')

    await waitFor(() => expect(mockSaveDraft).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Give your pet a name')).toBeNull()
  })

  it('says so when the draft could not be saved', async () => {
    mockSaveDraft.mockRejectedValueOnce(new Error('disk full'))
    await open('/pets/new')
    await screen.findByRole('header', { name: 'Let’s meet your pet' })

    await pressButton('Save as draft')

    expect(
      await screen.findByText('We couldn’t save the draft. Please try again.'),
    ).toBeOnTheScreen()
  })

  it('fills the form from a saved draft when it opens', async () => {
    mockLoadDraft.mockResolvedValue({ name: 'Luna', species: 'cat', breed: 'Tabby', years: '2' })
    await open('/pets/new')

    await waitFor(() => expect(field('Pet’s name').props.value).toBe('Luna'))
    expect(field('Breed or description').props.value).toBe('Tabby')
    expect(field('Years').props.value).toBe('2')
    expect(field('Months').props.value).toBe('')
    expect(screen.getByRole('radio', { name: 'Cat', checked: true })).toBeOnTheScreen()
  })

  it('does not overwrite what the person has already typed with a late draft', async () => {
    let release: (draft: PetDraft) => void = () => undefined
    mockLoadDraft.mockReturnValue(new Promise<PetDraft>((resolve) => (release = resolve)))
    await open('/pets/new')
    await screen.findByRole('header', { name: 'Let’s meet your pet' })
    await fireEvent.changeText(field('Pet’s name'), 'Milo')

    await act(async () => release({ name: 'Old draft' }))

    expect(field('Pet’s name').props.value).toBe('Milo')
  })

  it('opens an empty form when the draft cannot be read', async () => {
    mockLoadDraft.mockRejectedValue(new Error('unreadable'))
    await open('/pets/new')

    expect(await screen.findByRole('header', { name: 'Let’s meet your pet' })).toBeOnTheScreen()
    expect(field('Pet’s name').props.value).toBe('')
  })
})

describe('the form on any screen', () => {
  it('lets the person choose dog or cat, and tells assistive technology which is chosen', async () => {
    await open('/pets/new')
    await screen.findByRole('header', { name: 'Let’s meet your pet' })

    await fireEvent.press(screen.getByRole('radio', { name: 'Cat' }))

    expect(screen.getByRole('radio', { name: 'Cat', checked: true })).toBeOnTheScreen()
    expect(screen.getByRole('radio', { name: 'Dog', checked: false })).toBeOnTheScreen()
    expect(screen.getByRole('radio', { name: 'Cat' }).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true, checked: true }),
    )
  })

  it('keeps every control at least 44 pt tall', async () => {
    await open('/pets/new')
    await screen.findByRole('header', { name: 'Let’s meet your pet' })

    for (const name of ['Dog', 'Cat']) {
      const radio = screen.getByRole('radio', { name })
      expect(StyleSheet.flatten(radio.props.style).minHeight).toBeGreaterThanOrEqual(44)
    }
    for (const name of ['Back', 'Continue to photos', 'Save as draft']) {
      const button = screen.getByRole('button', { name })
      expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(44)
    }
  })

  it('hides its stickers from screen readers', async () => {
    await open('/pets/new')
    await screen.findByRole('header', { name: 'Let’s meet your pet' })

    expect(screen.queryByTestId('sticker-dog')).toBeNull()
    expect(screen.queryByTestId('sticker-cat')).toBeNull()
    expect(screen.getByTestId('sticker-dog', { includeHiddenElements: true })).toBeOnTheScreen()
  })

  it('goes Back to where it came from', async () => {
    const router = await open('/pets/new')
    await screen.findByRole('header', { name: 'Let’s meet your pet' })

    await pressButton('Back')

    await waitFor(() => expect(router.getPathname()).toBe('/home'))
  })

  it('is tinted for the owner flow, and a centred column of at most 560 pt on a wide screen', async () => {
    setWindowWidth(800, 900)
    await open('/pets/new')
    await screen.findByRole('header', { name: 'Let’s meet your pet' })

    expect(screen.getByTestId('glow-a', { includeHiddenElements: true })).toHaveStyle({
      backgroundColor: flowTints.owner.glowA,
    })
    expect(screen.getByTestId('content-column')).toHaveStyle({ maxWidth: 560 })
  })

  it.each(['/pets/new', `/pets/${PET_ID}`, `/pets/${PET_ID}/edit`])(
    'leads a signed-out person to sign-in (%s)',
    async (url) => {
      const router = await open(url, { signedIn: false })

      expect(await screen.findByText('Sign-in screen')).toBeOnTheScreen()
      expect(router.getPathname()).toBe('/sign-in')
    },
  )
})

describe('O05 Private profile', () => {
  it('shows the pet as private, with Discovery Off explained', async () => {
    await open(`/pets/${PET_ID}`)

    expect(await screen.findByRole('header', { name: 'Milo' })).toBeOnTheScreen()
    expect(screen.getByText('Golden retriever · 3 years')).toBeOnTheScreen()
    expect(screen.getByText('Private')).toBeOnTheScreen()
    expect(screen.getByRole('header', { name: 'Discovery Off' })).toBeOnTheScreen()
    expect(screen.getByText('Milo is not searchable.')).toBeOnTheScreen()
    expect(
      screen.getByText('Only an approved missing report can make recovery details discoverable.'),
    ).toBeOnTheScreen()
    expect(mockGetPet).toHaveBeenCalledWith(fake.client, PET_ID)
  })

  it.each([
    ['breed only', { ageMonths: null }, 'Golden retriever'],
    ['age only', { breed: null, ageMonths: 14 }, '1 year 2 months'],
    ['months only', { breed: null, ageMonths: 5 }, '5 months'],
    ['neither, so the species', { breed: null, ageMonths: null, species: 'cat' as const }, 'Cat'],
  ])('describes a pet by what it has: %s', async (_case, fields, line) => {
    mockGetPet.mockResolvedValue(makePet(fields))
    await open(`/pets/${PET_ID}`)

    expect(await screen.findByText(line)).toBeOnTheScreen()
  })

  it('does not offer to report the pet missing while the flag is off', async () => {
    await open(`/pets/${PET_ID}`)
    await screen.findByRole('header', { name: 'Milo' })

    expect(screen.queryByText('Report Milo missing')).toBeNull()
    expect(screen.queryByRole('button', { name: /missing/ })).toBeNull()
  })

  it('offers it only behind the feature flag', async () => {
    Object.assign(env.flags, { reportMissing: true })
    await open(`/pets/${PET_ID}`)

    expect(await screen.findByRole('button', { name: 'Report Milo missing' })).toBeOnTheScreen()
  })

  it('opens from the cached pets list without waiting for the server', async () => {
    cachedPets = [makePet({ id: uuid(9), name: 'Luna' }), milo]
    mockGetPet.mockReturnValue(new Promise(() => undefined))

    await open(`/pets/${PET_ID}`)

    expect(await screen.findByRole('header', { name: 'Milo' })).toBeOnTheScreen()
    expect(screen.getByText('Golden retriever · 3 years')).toBeOnTheScreen()
    // And still asks for a fresh copy.
    await waitFor(() => expect(mockGetPet).toHaveBeenCalledWith(fake.client, PET_ID))
  })

  it('shows what the server says when it differs from the cached copy', async () => {
    cachedPets = [makePet({ name: 'Milo' })]
    mockGetPet.mockResolvedValue(makePet({ name: 'Milo Jr' }))

    await open(`/pets/${PET_ID}`)

    expect(await screen.findByRole('header', { name: 'Milo Jr' })).toBeOnTheScreen()
  })

  it('shows a progress indicator while the pet loads', async () => {
    mockGetPet.mockReturnValue(new Promise(() => undefined))
    await open(`/pets/${PET_ID}`)

    expect(await screen.findByRole('progressbar', { name: 'Loading your pet' })).toBeOnTheScreen()
  })

  it('says so when there is no such pet, and leads back Home', async () => {
    mockGetPet.mockResolvedValue(null)
    const router = await open(`/pets/${PET_ID}`)

    expect(
      await screen.findByRole('header', { name: 'We couldn’t find this pet' }),
    ).toBeOnTheScreen()
    expect(screen.getByText('It may have been deleted.')).toBeOnTheScreen()
    expect(screen.queryByText('Discovery Off')).toBeNull()

    await pressButton('Back to Home')

    await waitFor(() => expect(router.getPathname()).toBe('/home'))
  })

  it('treats an id that is not a pet id the same way', async () => {
    mockGetPet.mockRejectedValue(new AppError('VALIDATION'))
    await open('/pets/not-a-pet')

    expect(
      await screen.findByRole('header', { name: 'We couldn’t find this pet' }),
    ).toBeOnTheScreen()
  })

  it('explains a failed load and tries again', async () => {
    mockGetPet.mockRejectedValueOnce(new AppError('UNKNOWN'))
    await open(`/pets/${PET_ID}`)

    expect(
      await screen.findByText('We couldn’t load this pet. Please try again.'),
    ).toBeOnTheScreen()

    await pressButton('Try again')

    expect(await screen.findByRole('header', { name: 'Milo' })).toBeOnTheScreen()
    expect(screen.queryByText('We couldn’t load this pet. Please try again.')).toBeNull()
  })

  it('says so when a load fails because the network does', async () => {
    mockGetPet.mockRejectedValue(new AppError('NETWORK'))
    await open(`/pets/${PET_ID}`)

    expect(
      await screen.findByText('You seem to be offline. Check your connection and try again.'),
    ).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen()
  })

  it('says so when the device is offline and the pet was never loaded', async () => {
    onlineManager.setOnline(false)
    await open(`/pets/${PET_ID}`)

    expect(
      await screen.findByText('You seem to be offline. Check your connection and try again.'),
    ).toBeOnTheScreen()
    expect(mockGetPet).not.toHaveBeenCalled()
  })

  it('hides the portrait and its sticker from screen readers', async () => {
    await open(`/pets/${PET_ID}`)
    await screen.findByRole('header', { name: 'Milo' })

    expect(screen.queryByTestId('pet-portrait')).toBeNull()
    expect(screen.queryByTestId('sticker-dog')).toBeNull()
    expect(screen.getByTestId('pet-portrait', { includeHiddenElements: true })).toBeOnTheScreen()
  })

  it('keeps its controls at least 44 pt tall', async () => {
    await open(`/pets/${PET_ID}`)
    await screen.findByRole('header', { name: 'Milo' })

    for (const name of ['Back', 'Edit', 'Add reference photos', 'Delete pet']) {
      const button = screen.getByRole('button', { name })
      expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(44)
    }
  })

  it('links to the reference photos', async () => {
    const router = await open(`/pets/${PET_ID}`)
    await screen.findByRole('header', { name: 'Milo' })

    await pressButton('Add reference photos')

    await waitFor(() => expect(router.getPathname()).toBe(`/pets/${PET_ID}/photos`))
  })

  it('goes Back Home when opened directly', async () => {
    const router = await open(`/pets/${PET_ID}`)
    await screen.findByRole('header', { name: 'Milo' })

    await pressButton('Back')

    await waitFor(() => expect(router.getPathname()).toBe('/home'))
  })

  it('is a centred column of at most 560 pt on a wide screen', async () => {
    setWindowWidth(1440, 1000)
    await open(`/pets/${PET_ID}`)
    await screen.findByRole('header', { name: 'Milo' })

    expect(screen.getByTestId('content-column')).toHaveStyle({ maxWidth: 560 })
  })
})

describe('Edit pet', () => {
  /** Opens the profile, then Edit, and waits for the form to carry Milo's details. */
  async function openEdit() {
    const router = await open(`/pets/${PET_ID}`)
    await screen.findByRole('header', { name: 'Milo' })
    await pressButton('Edit')
    await waitFor(() => expect(router.getPathname()).toBe(`/pets/${PET_ID}/edit`))
    await waitFor(() => expect(field('Pet’s name').props.value).toBe('Milo'))
    return router
  }

  it('opens the same form, filled in with what is saved', async () => {
    await openEdit()

    expect(screen.getByRole('header', { name: 'Edit Milo' })).toBeOnTheScreen()
    expect(field('Pet’s name').props.value).toBe('Milo')
    expect(field('Breed or description').props.value).toBe('Golden retriever')
    expect(field('Years').props.value).toBe('3')
    expect(field('Months').props.value).toBe('')
    expect(screen.getByRole('radio', { name: 'Dog', checked: true })).toBeOnTheScreen()
    // Editing is not adding: no draft, no step, no create.
    expect(screen.queryByRole('button', { name: 'Save as draft' })).toBeNull()
    expect(screen.queryByText('Step 1 of 3 · Basics')).toBeNull()
    expect(mockLoadDraft).not.toHaveBeenCalled()
    expect(mockRandomUUID).not.toHaveBeenCalled()
  })

  it('splits a stored age into years and months', async () => {
    mockGetPet.mockResolvedValue(makePet({ ageMonths: 38 }))
    await openEdit()

    expect(field('Years').props.value).toBe('3')
    expect(field('Months').props.value).toBe('2')
  })

  it('sends only what changed: an emptied breed is cleared with null, then back to the profile', async () => {
    const router = await openEdit()
    await fireEvent.changeText(field('Breed or description'), '')

    await pressButton('Save changes')

    await waitFor(() =>
      expect(mockUpdatePet).toHaveBeenCalledWith(fake.client, PET_ID, { breed: null }),
    )
    expect(mockUpdatePet).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(router.getPathname()).toBe(`/pets/${PET_ID}`))
    expect(mockCreatePet).not.toHaveBeenCalled()
  })

  it('sends a changed name, species and age, and nothing else', async () => {
    await openEdit()
    await fireEvent.changeText(field('Pet’s name'), ' Milo Jr ')
    await fireEvent.press(screen.getByRole('radio', { name: 'Cat' }))
    await fireEvent.changeText(field('Years'), '4')
    await fireEvent.changeText(field('Months'), '6')

    await pressButton('Save changes')

    await waitFor(() =>
      expect(mockUpdatePet).toHaveBeenCalledWith(fake.client, PET_ID, {
        name: 'Milo Jr',
        species: 'cat',
        ageMonths: 54,
      }),
    )
  })

  it('clears the age with null when both age fields are emptied', async () => {
    await openEdit()
    await fireEvent.changeText(field('Years'), '')

    await pressButton('Save changes')

    await waitFor(() =>
      expect(mockUpdatePet).toHaveBeenCalledWith(fake.client, PET_ID, { ageMonths: null }),
    )
  })

  it('makes no request when nothing changed, and just goes back', async () => {
    const router = await openEdit()
    // Spaces around the same name are not a change.
    await fireEvent.changeText(field('Pet’s name'), ' Milo ')

    await pressButton('Save changes')

    await waitFor(() => expect(router.getPathname()).toBe(`/pets/${PET_ID}`))
    expect(mockUpdatePet).not.toHaveBeenCalled()
  })

  it('shows the saved pet on the profile straight away and refreshes the list', async () => {
    mockUpdatePet.mockResolvedValue(makePet({ breed: null }))
    mockGetPet.mockResolvedValue(milo)
    await openEdit()
    queryClient?.setQueryData(['pets'], [milo])
    await fireEvent.changeText(field('Breed or description'), '')

    await pressButton('Save changes')

    expect(await screen.findByText('3 years')).toBeOnTheScreen()
    expect(screen.queryByText('Golden retriever · 3 years')).toBeNull()
    expect(queryClient?.getQueryData<Pet>(['pet', PET_ID])?.breed).toBeNull()
    expect(queryClient?.getQueryState(['pets'])?.isInvalidated).toBe(true)
  })

  it('checks the details like the add form does', async () => {
    await openEdit()
    await fireEvent.changeText(field('Pet’s name'), '')

    await pressButton('Save changes')

    expect(await screen.findByText('Give your pet a name')).toBeOnTheScreen()
    expect(mockUpdatePet).not.toHaveBeenCalled()
  })

  it('keeps the form and says so when saving fails', async () => {
    const reports = sentryReports()
    mockUpdatePet.mockRejectedValue(new AppError('UNKNOWN'))
    const router = await openEdit()
    await fireEvent.changeText(field('Breed or description'), 'Beagle')

    await pressButton('Save changes')

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeOnTheScreen()
    expect(router.getPathname()).toBe(`/pets/${PET_ID}/edit`)
    expect(field('Breed or description').props.value).toBe('Beagle')
    expect(reports()).toEqual(['UNKNOWN in updatePet'])
  })

  it('offline, keeps the changes and waits for a connection to save them', async () => {
    await openEdit()
    await fireEvent.changeText(field('Breed or description'), 'Beagle')

    await act(async () => onlineManager.setOnline(false))

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
    expect(screen.getByText('Saving changes needs a connection')).toBeOnTheScreen()

    await act(async () => onlineManager.setOnline(true))
    await pressButton('Save changes')

    await waitFor(() =>
      expect(mockUpdatePet).toHaveBeenCalledWith(fake.client, PET_ID, { breed: 'Beagle' }),
    )
  })

  it('says there is no such pet when it cannot be found', async () => {
    mockGetPet.mockResolvedValue(null)
    await open(`/pets/${PET_ID}/edit`)

    expect(
      await screen.findByRole('header', { name: 'We couldn’t find this pet' }),
    ).toBeOnTheScreen()
    expect(screen.queryByLabelText('Pet’s name')).toBeNull()
  })

  it('goes Back to the profile', async () => {
    const router = await openEdit()

    await pressButton('Back')

    await waitFor(() => expect(router.getPathname()).toBe(`/pets/${PET_ID}`))
    expect(mockUpdatePet).not.toHaveBeenCalled()
  })
})

describe('Delete pet', () => {
  const CONFIRM = 'Yes, delete Milo'

  async function openDeleteDialog() {
    const router = await open(`/pets/${PET_ID}`)
    await screen.findByRole('header', { name: 'Milo' })
    await pressButton('Delete pet')
    const dialog = await screen.findByLabelText('Delete Milo?')
    return { router, dialog }
  }

  it('asks first, in a labelled dialog, and deletes nothing until it is confirmed', async () => {
    const { dialog } = await openDeleteDialog()

    expect(dialog.props.role).toBe('alertdialog')
    expect(dialog.props['aria-modal']).toBe(true)
    expect(dialog.props.accessibilityViewIsModal).toBe(true)
    expect(
      within(dialog).getByText(
        'This permanently deletes Milo and their reference photos. It can’t be undone.',
      ),
    ).toBeOnTheScreen()
    expect(mockDeletePet).not.toHaveBeenCalled()
  })

  it('puts Cancel first and gives the destructive action the urgent button', async () => {
    const { dialog } = await openDeleteDialog()

    const [first, second] = within(dialog).getAllByRole('button')
    expect(within(first).getByText('Cancel')).toBeOnTheScreen()
    expect(within(second).getByText(CONFIRM)).toBeOnTheScreen()
    expect(within(dialog).getByRole('button', { name: CONFIRM })).toHaveStyle({
      backgroundColor: colors.deepBlue,
    })
  })

  it('closes on Cancel without deleting', async () => {
    const { dialog, router } = await openDeleteDialog()

    await fireEvent.press(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByLabelText('Delete Milo?')).toBeNull())
    expect(mockDeletePet).not.toHaveBeenCalled()
    expect(router.getPathname()).toBe(`/pets/${PET_ID}`)
  })

  it('deletes on confirmation, refreshes the list and plan, drops the pet’s copy and goes Home', async () => {
    const { dialog, router } = await openDeleteDialog()
    queryClient?.setQueryData(['pets'], [milo])
    queryClient?.setQueryData(['entitlement'], { tier: 'free', petLimit: 3, activePets: 1 })

    await fireEvent.press(within(dialog).getByRole('button', { name: CONFIRM }))

    await waitFor(() => expect(mockDeletePet).toHaveBeenCalledWith(fake.client, PET_ID))
    expect(await screen.findByText('Home screen')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/home')
    expect(queryClient?.getQueryState(['pets'])?.isInvalidated).toBe(true)
    expect(queryClient?.getQueryState(['entitlement'])?.isInvalidated).toBe(true)
    expect(queryClient?.getQueryData(['pet', PET_ID])).toBeUndefined()
  })

  it('returns to the Home it was opened from, without stacking a second Home', async () => {
    // From Home the profile is pushed over the tabs; going "back" to Home must not leave the
    // deleted pet's screen (or a second tab layout) underneath.
    fake = fakeClient({ userId: 'u1', email: 'alex@example.com' })
    const router = await renderRouter(
      {
        _layout: testRootStackLayout(fake.client),
        '(tabs)/_layout': TabsLayout,
        '(tabs)/home': stub('Home screen'),
        '(tabs)/find': stub('Find screen'),
        '(tabs)/alerts': stub('Alerts screen'),
        '(tabs)/account': stub('Account screen'),
        'pets/[id]/index': withCache(PetProfileRoute),
      },
      { initialUrl: '/home' },
    )
    await screen.findByText('Home screen')
    await act(async () => appRouter.push(`/pets/${PET_ID}`))
    await screen.findByRole('header', { name: 'Milo' })
    await pressButton('Delete pet')
    const dialog = await screen.findByLabelText('Delete Milo?')

    await fireEvent.press(within(dialog).getByRole('button', { name: CONFIRM }))

    expect(await screen.findByText('Home screen')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/home')
    // The app's root stack (under expo-router's own __root) holds one tab layout and nothing else.
    const rootStack = router.getRouterState()?.routes[0]?.state
    expect(rootStack?.routes.map((route) => route.name)).toEqual(['(tabs)'])
    expect(appRouter.canGoBack()).toBe(false)
  })

  it('deletes once however fast the confirmation is pressed', async () => {
    mockDeletePet.mockImplementation(() => new Promise(() => undefined))
    const { dialog } = await openDeleteDialog()

    await pressTwiceInOneTick(within(dialog).getByRole('button', { name: CONFIRM }))

    expect(mockDeletePet).toHaveBeenCalledTimes(1)
  })

  it('shows progress and keeps Cancel from closing the dialog mid-delete', async () => {
    mockDeletePet.mockImplementation(() => new Promise(() => undefined))
    const { dialog } = await openDeleteDialog()

    await fireEvent.press(within(dialog).getByRole('button', { name: CONFIRM }))

    expect(within(dialog).getByRole('button', { name: CONFIRM })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })

  it('stays on the profile with a friendly note when the deletion fails, and can be tried again', async () => {
    const reports = sentryReports()
    mockDeletePet.mockRejectedValueOnce(new AppError('UNKNOWN'))
    const { dialog, router } = await openDeleteDialog()

    await fireEvent.press(within(dialog).getByRole('button', { name: CONFIRM }))

    expect(await screen.findByText('We couldn’t delete Milo. Please try again.')).toBeOnTheScreen()
    expect(reports()).toEqual(['UNKNOWN in deletePet'])
    expect(router.getPathname()).toBe(`/pets/${PET_ID}`)
    expect(screen.queryByLabelText('Delete Milo?')).toBeNull()
    expect(screen.getByRole('header', { name: 'Milo' })).toBeOnTheScreen()

    await pressButton('Delete pet')
    await fireEvent.press(
      within(await screen.findByLabelText('Delete Milo?')).getByRole('button', { name: CONFIRM }),
    )

    expect(await screen.findByText('Home screen')).toBeOnTheScreen()
    expect(mockDeletePet).toHaveBeenCalledTimes(2)
  })

  it('says when the device is offline, without waiting for the network to come back', async () => {
    mockDeletePet.mockRejectedValueOnce(new AppError('NETWORK'))
    const { dialog } = await openDeleteDialog()
    // The dialog was already open: the confirmed deletion is still tried, and fails at once.
    await act(async () => onlineManager.setOnline(false))

    await fireEvent.press(within(dialog).getByRole('button', { name: CONFIRM }))

    expect(
      await screen.findByText('You seem to be offline. Check your connection and try again.'),
    ).toBeOnTheScreen()
  })
})
