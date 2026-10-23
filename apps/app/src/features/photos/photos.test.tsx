import type { ComponentType, ReactNode } from 'react'
import { Dimensions, Linking, Platform, StyleSheet, Text, processColor } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { onlineManager, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { randomUUID } from 'expo-crypto'
import { router as appRouter } from 'expo-router'
import {
  act,
  fireEvent,
  renderHook,
  renderRouter,
  screen,
  waitFor,
  within,
} from 'expo-router/testing-library'
import {
  checkSession,
  deletePhoto,
  getPet,
  listPhotos,
  uploadPhoto,
  type Pet,
  type PetPhoto,
} from '@pawpin/api'
import { AppError, LIMITS, type PhotoView } from '@pawpin/core'
import { cardRoles, flowTints } from '@pawpin/ui'

import PhotosRoute from '../../../app/pets/[id]/photos'
import { usePhotoUpload } from '../../data/usePhotoUpload'
import { env } from '../../env'
import { fakeClient } from '../../testing/fakeClient'
import { FIXTURE_SIZE, fixtureBase64, fixtureNamed, isFixture } from '../../testing/fixtures'
import { TestProviders, testRootStackLayout } from '../../testing/TestRoot'
import { setWindowWidth } from '../../testing/window'

jest.mock('@pawpin/api', () => ({
  ...jest.requireActual('@pawpin/api'),
  getPet: jest.fn(),
  listPhotos: jest.fn(),
  uploadPhoto: jest.fn(),
  deletePhoto: jest.fn(),
  checkSession: jest.fn(),
}))
// jest-expo stubs the native module, so `randomUUID` would return undefined.
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }))

// The three native modules are replaced where the app meets them. `preparePhoto` and everything
// else in the app run for real, over the committed fixtures (see `mockManipulate`).
const mockLaunchImageLibrary = jest.fn()
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchImageLibrary(...args),
}))

const mockTakePicture = jest.fn()
const mockRequestPermission = jest.fn()
let mockPermission: unknown = null
jest.mock('expo-camera', () => {
  const React = jest.requireActual<typeof import('react')>('react')
  const { View } = jest.requireActual<typeof import('react-native')>('react-native')
  class CameraView extends React.Component<Record<string, unknown>> {
    takePictureAsync(...args: unknown[]) {
      return mockTakePicture(...args)
    }
    render() {
      return React.createElement(View, { testID: 'camera-view', ...this.props })
    }
  }
  return {
    CameraView,
    useCameraPermissions: () => {
      const [permission, setPermission] = React.useState(mockPermission)
      const request = async () => {
        const next = await mockRequestPermission()
        setPermission(next)
        return next
      }
      return [permission, request]
    },
  }
})

// Metro turns an imported image into an asset id that `expo-asset` resolves to a URI. Jest's
// transformer leaves `{ testUri }`, so the file's name stands in for the URI.
const mockAssetDownload = jest.fn()
jest.mock('expo-asset', () => ({
  Asset: {
    fromModule: (asset: { testUri: string }) => ({
      uri: `http://dev-server/${asset.testUri.split('/').pop()}`,
      localUri: null as string | null,
      async downloadAsync() {
        mockAssetDownload()
        this.localUri = `file:///bundle/${asset.testUri.split('/').pop()}`
        return this
      },
    }),
  },
}))

/** The photo a native manipulator would produce, named by the file its URI ends with. */
const mockManipulate = jest.fn()
jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: (...args: unknown[]) => mockManipulate(...args) },
  SaveFormat: { JPEG: 'jpeg' },
}))

const mockGetPet = jest.mocked(getPet)
const mockListPhotos = jest.mocked(listPhotos)
const mockUploadPhoto = jest.mocked(uploadPhoto)
const mockDeletePhoto = jest.mocked(deletePhoto)
const mockCheckSession = jest.mocked(checkSession)
const mockRandomUUID = jest.mocked(randomUUID)

const PET_ID = '2f0c9a64-1b5e-4c6d-8a3f-5d7e9b1c2a40'
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const GUIDANCE = 'Use daylight. Keep the face and coat visible. Avoid filters and blurry photos.'
const BLURRY_MESSAGE = 'That photo looks blurry — try again in better light'
const OFFLINE = 'You seem to be offline. Check your connection and try again.'

const milo: Pet = {
  id: PET_ID,
  name: 'Milo',
  species: 'dog',
  breed: 'Golden retriever',
  ageMonths: 36,
  registrationState: 'private',
  discoveryEnabled: false,
  createdAt: '2026-10-01T00:00:00Z',
}

function readyPhoto(view: PhotoView, id: string): PetPhoto {
  return {
    id,
    petId: PET_ID,
    view,
    status: 'ready',
    ...FIXTURE_SIZE,
    signedUrl: `https://signed.example/${id}?token=1`,
  }
}

/** What the server does with an upload: it keeps one ready photo per view, so a new one replaces. */
function saveOnServer(upload: { view: PhotoView; id: string }): PetPhoto {
  const photo = readyPhoto(upload.view, upload.id)
  serverPhotos = [...serverPhotos.filter((p) => p.view !== upload.view), photo]
  return photo
}

/** Holds the next upload until the returned function is called; then it saves like any other. */
function holdNextUpload(): () => void {
  let open: () => void = () => undefined
  const gate = new Promise<void>((resolve) => (open = resolve))
  mockUploadPhoto.mockImplementationOnce(async (_client, upload) => {
    await gate
    return saveOnServer(upload)
  })
  return open
}

/** The pet's photos on the "server": what `listPhotos` answers, and what an upload adds to. */
let serverPhotos: PetPhoto[] = []
let fake: ReturnType<typeof fakeClient>
let queryClient: QueryClient | null = null

function withCache(Screen: ComponentType) {
  return function WithCache() {
    const client = useQueryClient()
    if (queryClient !== client) {
      queryClient = client
      // The app retries a network failure three times with a backoff; a test shouldn't wait for it.
      client.setQueryDefaults(['pet'], { retry: false })
      client.setQueryDefaults(['photos'], { retry: false })
    }
    return <Screen />
  }
}

function stub(label: string) {
  return function Stub() {
    return <Text>{label}</Text>
  }
}

async function open(url = `/pets/${PET_ID}/photos`, { signedIn = true } = {}) {
  queryClient = null
  fake = fakeClient({ userId: signedIn ? 'u1' : null, email: 'alex@example.com' })
  return renderRouter(
    {
      _layout: testRootStackLayout(fake.client),
      '(tabs)/home': stub('Home screen'),
      '(auth)/sign-in': stub('Sign-in screen'),
      'pets/[id]/index': stub('Profile screen'),
      'pets/[id]/photos': withCache(PhotosRoute),
    },
    { initialUrl: url },
  )
}

async function openPhotos() {
  const router = await open()
  await screen.findByRole('header', { name: 'A clearer photo helps' })
  // The tiles wait for the photos to load.
  await screen.findByLabelText('Reference photos')
  return router
}

const button = (name: string | RegExp) => screen.getByRole('button', { name })
const pressButton = (name: string | RegExp) => fireEvent.press(button(name))
const tile = (label: string, checked?: boolean) =>
  screen.getByRole('radio', checked === undefined ? { name: label } : { name: label, checked })

/** The photo library will give back the fixture `name` (a different `folder` is a different file). */
function libraryGives(name: string, folder = 'a') {
  mockLaunchImageLibrary.mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: `file:///library/${folder}/${name}.jpg` }],
  })
}

const uploadCall = (n: number) => mockUploadPhoto.mock.calls[n]![1]

/** What the native manipulator makes of `uri`: the fixture its file name says, or an error. */
function fixtureImage(uri: string) {
  return {
    release: jest.fn(),
    renderAsync: async () => ({
      release: jest.fn(),
      saveAsync: async () => {
        const name = fixtureNamed(uri)
        if (name === undefined) throw new Error(`cannot read ${uri}`)
        return { uri: `${uri}#prepared`, ...FIXTURE_SIZE, base64: fixtureBase64(name) }
      },
    }),
  }
}

/** Holds the check of the next photo until the returned function is called. */
function holdNextCheck(): () => void {
  let open: () => void = () => undefined
  const gate = new Promise<void>((resolve) => (open = resolve))
  mockManipulate.mockImplementationOnce((uri: string) => {
    const image = fixtureImage(uri)
    return {
      ...image,
      renderAsync: async () => {
        await gate
        return image.renderAsync()
      },
    }
  })
  return open
}

let uuidCount = 0
beforeEach(async () => {
  await AsyncStorage.clear()
  uuidCount = 0
  serverPhotos = []
  mockRandomUUID.mockReset().mockImplementation(() => uuid(++uuidCount))
  mockGetPet.mockReset().mockResolvedValue(milo)
  mockListPhotos.mockReset().mockImplementation(async () => serverPhotos.map((p) => ({ ...p })))
  mockUploadPhoto.mockReset().mockImplementation(async (_client, upload) => saveOnServer(upload))
  mockDeletePhoto.mockReset().mockResolvedValue(undefined)
  mockCheckSession.mockReset().mockResolvedValue('unknown')
  mockAssetDownload.mockReset()
  mockLaunchImageLibrary.mockReset()
  mockTakePicture.mockReset()
  mockRequestPermission.mockReset()
  mockPermission = null
  mockManipulate.mockReset().mockImplementation(fixtureImage)
  env.e2e = false
})

const initialWindow = Dimensions.get('window')
afterEach(() => {
  onlineManager.setOnline(true)
  env.e2e = false
  setWindowWidth(initialWindow.width, initialWindow.height)
})

describe('O04 reference photos', () => {
  it('shows the front, side and markings tiles with the guidance, and Front selected', async () => {
    await openPhotos()

    expect(screen.getByText(GUIDANCE)).toBeOnTheScreen()
    expect(screen.getByLabelText('Reference photos')).toBeOnTheScreen()
    expect(tile('Front photo, not added', true)).toBeOnTheScreen()
    expect(tile('Side photo, not added', false)).toBeOnTheScreen()
    expect(tile('Markings photo, not added', false)).toBeOnTheScreen()
    expect(screen.getByText('Face the camera, with the whole face in view.')).toBeOnTheScreen()
    expect(mockGetPet).toHaveBeenCalledWith(fake.client, PET_ID)
    expect(mockListPhotos).toHaveBeenCalledWith(fake.client, PET_ID)
  })

  it('selects a tile, and offers what it needs for that view', async () => {
    await openPhotos()

    await fireEvent.press(tile('Markings photo, not added'))

    expect(tile('Markings photo, not added', true)).toBeOnTheScreen()
    expect(tile('Front photo, not added', false)).toBeOnTheScreen()
    expect(
      screen.getByText('Get close to patches, spots, scars or a collar tag.'),
    ).toBeOnTheScreen()
    expect(screen.queryByText('Face the camera, with the whole face in view.')).toBeNull()
    expect(tile('Markings photo, not added').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true, checked: true }),
    )
  })

  it('shows a ready photo as a thumbnail from its signed URL', async () => {
    serverPhotos = [readyPhoto('front', uuid(50)), readyPhoto('side', uuid(51))]
    await openPhotos()

    expect(await screen.findByRole('radio', { name: 'Front photo, ready' })).toBeOnTheScreen()
    expect(tile('Side photo, ready')).toBeOnTheScreen()
    expect(tile('Markings photo, not added')).toBeOnTheScreen()
    expect(screen.getByTestId('thumb-front').props.source).toEqual({
      uri: `https://signed.example/${uuid(50)}?token=1`,
    })
    expect(screen.getByTestId('thumb-side').props.source).toEqual({
      uri: `https://signed.example/${uuid(51)}?token=1`,
    })
    expect(screen.queryByTestId('thumb-markings')).toBeNull()

    // A ready photo is replaced by retaking it; the other views are asked for for the first time.
    expect(button('Retake photo')).toBeOnTheScreen()
    await fireEvent.press(tile('Markings photo, not added'))
    expect(button('Take photo')).toBeOnTheScreen()
  })

  it('ignores photos that are not ready, and shows the newest of several', async () => {
    serverPhotos = [
      { ...readyPhoto('front', uuid(50)), status: 'rejected', signedUrl: null },
      readyPhoto('front', uuid(51)),
      { ...readyPhoto('front', uuid(52)), status: 'pending', width: 0, height: 0, signedUrl: null },
    ]
    await openPhotos()

    expect(await screen.findByRole('radio', { name: 'Front photo, ready' })).toBeOnTheScreen()
    expect(screen.getByTestId('thumb-front').props.source).toEqual({
      uri: `https://signed.example/${uuid(51)}?token=1`,
    })
  })

  it('shows a pet portrait instead of a thumbnail when a ready photo has no URL', async () => {
    serverPhotos = [{ ...readyPhoto('front', uuid(50)), signedUrl: null }]
    await openPhotos()

    expect(await screen.findByRole('radio', { name: 'Front photo, ready' })).toBeOnTheScreen()
    expect(screen.queryByTestId('thumb-front')).toBeNull()
  })

  it('hides its stickers from screen readers', async () => {
    await openPhotos()

    expect(screen.queryByTestId('sticker-dog')).toBeNull()
    expect(
      screen.getAllByTestId('sticker-dog', { includeHiddenElements: true }).length,
    ).toBeGreaterThan(0)
  })

  it('says so when the photos cannot be loaded, and loads them on a retry', async () => {
    mockListPhotos.mockRejectedValueOnce(new AppError('NETWORK'))
    serverPhotos = [readyPhoto('front', uuid(50))]
    await openPhotos()

    expect(await screen.findByText(OFFLINE)).toBeOnTheScreen()
    expect(tile('Front photo, not added')).toBeOnTheScreen()

    await pressButton('Try again')

    expect(await screen.findByRole('radio', { name: 'Front photo, ready' })).toBeOnTheScreen()
    expect(screen.queryByText(OFFLINE)).toBeNull()
  })

  it('says so when there is no such pet', async () => {
    mockGetPet.mockResolvedValue(null)
    await open()

    expect(
      await screen.findByRole('header', { name: 'We couldn’t find this pet' }),
    ).toBeOnTheScreen()
    expect(mockListPhotos).not.toHaveBeenCalledWith(fake.client, PET_ID)
  })

  it('leads a signed-out person to sign-in', async () => {
    const router = await open(`/pets/${PET_ID}/photos`, { signedIn: false })

    expect(await screen.findByText('Sign-in screen')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/sign-in')
    expect(mockListPhotos).not.toHaveBeenCalled()
  })

  it('is tinted for the owner flow, and a centred column of at most 560 pt on a wide screen', async () => {
    setWindowWidth(800, 900)
    await openPhotos()

    expect(screen.getByTestId('glow-a', { includeHiddenElements: true })).toHaveStyle({
      backgroundColor: flowTints.owner.glowA,
    })
    expect(screen.getByTestId('content-column')).toHaveStyle({ maxWidth: 560 })
  })

  it('keeps every control at least 44 pt tall', async () => {
    await openPhotos()

    for (const name of ['Front photo, not added', 'Side photo, not added']) {
      expect(StyleSheet.flatten(tile(name).props.style).minHeight).toBeGreaterThanOrEqual(44)
    }
    for (const name of ['Back', 'Take photo', 'Choose from library', 'Finish later']) {
      expect(StyleSheet.flatten(button(name).props.style).minHeight).toBeGreaterThanOrEqual(44)
    }
  })

  it('goes Back to where it came from, and Done does the same', async () => {
    const router = await open(`/pets/${PET_ID}`)
    await screen.findByText('Profile screen')
    await act(async () => appRouter.push(`/pets/${PET_ID}/photos`))
    await screen.findByRole('header', { name: 'A clearer photo helps' })

    await pressButton('Back')
    await waitFor(() => expect(router.getPathname()).toBe(`/pets/${PET_ID}`))

    await act(async () => appRouter.push(`/pets/${PET_ID}/photos`))
    await screen.findByRole('header', { name: 'A clearer photo helps' })
    await pressButton('Finish later')
    await waitFor(() => expect(router.getPathname()).toBe(`/pets/${PET_ID}`))
  })

  it('offers Done once all three photos are ready', async () => {
    serverPhotos = [
      readyPhoto('front', uuid(50)),
      readyPhoto('side', uuid(51)),
      readyPhoto('markings', uuid(52)),
    ]
    await openPhotos()

    expect(await screen.findByRole('button', { name: 'Done' })).toBeOnTheScreen()
    expect(screen.queryByRole('button', { name: 'Finish later' })).toBeNull()
  })
})

describe('adding a photo from the library', () => {
  it('prepares the photo, uploads it with a fresh id, and shows it as ready', async () => {
    libraryGives('front')
    await openPhotos()

    await pressButton('Choose from library')

    expect(await screen.findByRole('radio', { name: 'Front photo, ready' })).toBeOnTheScreen()
    expect(mockUploadPhoto).toHaveBeenCalledTimes(1)
    expect(mockUploadPhoto).toHaveBeenCalledWith(
      fake.client,
      expect.objectContaining({
        id: uuid(1),
        petId: PET_ID,
        view: 'front',
        ...FIXTURE_SIZE,
      }),
    )
    // The photo that was measured is the photo that is sent.
    const sent = uploadCall(0)
    expect(isFixture(sent.jpeg, 'front')).toBe(true)
    expect(sent.blurScore).toBeGreaterThan(LIMITS.blurMin)
    expect(sent.brightness).toBeGreaterThanOrEqual(LIMITS.brightnessMin)
    expect(sent.brightness).toBeLessThanOrEqual(LIMITS.brightnessMax)
    expect(screen.getByTestId('thumb-front').props.source).toEqual({
      uri: `https://signed.example/${uuid(1)}?token=1`,
    })
    expect(mockLaunchImageLibrary).toHaveBeenCalledTimes(1)
  })

  it('moves on to the next view when one is done', async () => {
    libraryGives('front')
    await openPhotos()

    await pressButton('Choose from library')

    await waitFor(() => expect(tile('Side photo, not added', true)).toBeOnTheScreen())
    expect(tile('Front photo, ready', false)).toBeOnTheScreen()
  })

  it('stays where it is when the person has gone to another tile meanwhile', async () => {
    const finish = holdNextUpload()
    libraryGives('front')
    await openPhotos()
    await pressButton('Choose from library')
    await screen.findByRole('radio', { name: 'Front photo, uploading' })
    await fireEvent.press(tile('Markings photo, not added'))

    await act(async () => finish())

    await screen.findByRole('radio', { name: 'Front photo, ready' })
    expect(tile('Markings photo, not added', true)).toBeOnTheScreen()
  })

  it('shows each step of the way in words, never as motion', async () => {
    const finish = holdNextUpload()
    libraryGives('front')
    await openPhotos()

    await pressButton('Choose from library')

    expect(await screen.findByRole('radio', { name: 'Front photo, uploading' })).toBeOnTheScreen()
    expect(screen.getByText('Uploading…')).toBeOnTheScreen()
    // Nothing else can be started for this view while it uploads.
    expect(button('Take photo')).toBeDisabled()
    expect(button('Choose from library')).toBeDisabled()

    await act(async () => finish())

    expect(await screen.findByRole('radio', { name: 'Front photo, ready' })).toBeOnTheScreen()
    expect(screen.getByText('Ready')).toBeOnTheScreen()
  })

  it('does nothing when the picker is closed without a photo', async () => {
    mockLaunchImageLibrary.mockResolvedValueOnce({ canceled: true, assets: null })
    await openPhotos()

    await pressButton('Choose from library')

    await waitFor(() => expect(mockLaunchImageLibrary).toHaveBeenCalledTimes(1))
    expect(mockUploadPhoto).not.toHaveBeenCalled()
    expect(tile('Front photo, not added', true)).toBeOnTheScreen()
  })

  it('opens the picker for images only', async () => {
    mockLaunchImageLibrary.mockResolvedValueOnce({ canceled: true, assets: null })
    await openPhotos()

    await pressButton('Choose from library')

    await waitFor(() =>
      expect(mockLaunchImageLibrary).toHaveBeenCalledWith(
        expect.objectContaining({ mediaTypes: ['images'], allowsMultipleSelection: false }),
      ),
    )
  })

  it('says so when the picker itself fails', async () => {
    mockLaunchImageLibrary.mockRejectedValueOnce(new Error('picker unavailable'))
    await openPhotos()

    await pressButton('Choose from library')

    expect(
      await screen.findByText('We couldn’t open your photos. Please try again.'),
    ).toBeOnTheScreen()
    expect(mockUploadPhoto).not.toHaveBeenCalled()
  })

  it('says so when a photo cannot be read, and uploads nothing', async () => {
    libraryGives('corrupt')
    await openPhotos()

    await pressButton('Choose from library')

    expect(
      await screen.findByText('We couldn’t read that photo. Please try a different one.'),
    ).toBeOnTheScreen()
    expect(mockUploadPhoto).not.toHaveBeenCalled()
    expect(tile('Front photo, needs a new photo')).toBeOnTheScreen()
  })
})

describe('the quality check', () => {
  it('shows the blurry guidance, keeps the previous ready photo, and uploads nothing', async () => {
    serverPhotos = [readyPhoto('front', uuid(50))]
    libraryGives('blurry')
    await openPhotos()
    await screen.findByRole('radio', { name: 'Front photo, ready' })

    await pressButton('Choose from library')

    expect(await screen.findByText(BLURRY_MESSAGE)).toBeOnTheScreen()
    expect(screen.getByTestId('auth-problem').props.role).toBe('alert')
    expect(mockUploadPhoto).not.toHaveBeenCalled()
    // The earlier photo is still the tile's photo, in what is shown and in what is announced.
    expect(tile('Front photo, ready, earlier photo kept')).toBeOnTheScreen()
    expect(screen.getByText('Ready · earlier photo kept')).toBeOnTheScreen()
    expect(screen.getByTestId('thumb-front').props.source).toEqual({
      uri: `https://signed.example/${uuid(50)}?token=1`,
    })
    expect(serverPhotos).toHaveLength(1)
  })

  it('marks a view with no earlier photo as needing a new one', async () => {
    libraryGives('blurry')
    await openPhotos()

    await pressButton('Choose from library')

    expect(await screen.findByText(BLURRY_MESSAGE)).toBeOnTheScreen()
    expect(tile('Front photo, needs a new photo')).toBeOnTheScreen()
    expect(screen.getByText('Couldn’t add this photo')).toBeOnTheScreen()
    expect(screen.queryByTestId('thumb-front')).toBeNull()
    // A blurry photo can't be sent again: the way on is a new one, not "Try again".
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(button('Take photo')).toBeEnabled()
  })

  it('clears the message when another photo is added', async () => {
    libraryGives('blurry')
    await openPhotos()
    await pressButton('Choose from library')
    await screen.findByText(BLURRY_MESSAGE)

    libraryGives('front', 'b')
    await pressButton('Choose from library')

    await screen.findByRole('radio', { name: 'Front photo, ready' })
    expect(screen.queryByText(BLURRY_MESSAGE)).toBeNull()
    expect(mockUploadPhoto).toHaveBeenCalledTimes(1)
  })

  it('checks the photo before anything is sent', async () => {
    libraryGives('blurry')
    await openPhotos()

    await pressButton('Choose from library')
    await screen.findByText(BLURRY_MESSAGE)

    // The photo was resized and measured on the device, and never left it.
    expect(mockManipulate).toHaveBeenCalled()
    expect(mockUploadPhoto).not.toHaveBeenCalled()
    expect(mockRandomUUID).not.toHaveBeenCalled()
  })
})

describe('upload problems', () => {
  it('lets the same photo be sent again after the network fails, with the same id', async () => {
    mockUploadPhoto.mockRejectedValueOnce(new AppError('NETWORK'))
    libraryGives('front')
    await openPhotos()

    await pressButton('Choose from library')

    expect(await screen.findByText(OFFLINE)).toBeOnTheScreen()
    expect(tile('Front photo, needs a new photo')).toBeOnTheScreen()
    expect(mockLaunchImageLibrary).toHaveBeenCalledTimes(1)

    await pressButton('Try again')

    expect(await screen.findByRole('radio', { name: 'Front photo, ready' })).toBeOnTheScreen()
    expect(mockUploadPhoto).toHaveBeenCalledTimes(2)
    expect(uploadCall(0).id).toBe(uuid(1))
    expect(uploadCall(1).id).toBe(uuid(1))
    expect(isFixture(uploadCall(1).jpeg, 'front')).toBe(true)
    expect(uploadCall(1).jpeg).toBe(uploadCall(0).jpeg)
    // The photo was not asked for, measured or given an id twice.
    expect(mockLaunchImageLibrary).toHaveBeenCalledTimes(1)
    expect(mockRandomUUID).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(OFFLINE)).toBeNull()
  })

  it('keeps the previous ready photo when a new one fails to upload', async () => {
    serverPhotos = [readyPhoto('front', uuid(50))]
    mockUploadPhoto.mockRejectedValueOnce(new AppError('NETWORK'))
    libraryGives('front')
    await openPhotos()
    await screen.findByRole('radio', { name: 'Front photo, ready' })

    await pressButton('Choose from library')

    expect(await screen.findByText(OFFLINE)).toBeOnTheScreen()
    expect(tile('Front photo, ready, earlier photo kept')).toBeOnTheScreen()
    expect(screen.getByTestId('thumb-front').props.source).toEqual({
      uri: `https://signed.example/${uuid(50)}?token=1`,
    })
    expect(button('Try again')).toBeOnTheScreen()
  })

  it.each([
    ['a photo that cannot be read', 'corrupt', undefined],
    ['the rate limit', 'front', new AppError('RATE_LIMITED')],
    ['an unexpected failure', 'front', new AppError('UNKNOWN')],
  ])('keeps the previous ready photo after %s', async (_case, file, failure) => {
    serverPhotos = [readyPhoto('front', uuid(50))]
    if (failure !== undefined) mockUploadPhoto.mockRejectedValueOnce(failure)
    libraryGives(file, 'b')
    await openPhotos()
    await screen.findByRole('radio', { name: 'Front photo, ready' })

    await pressButton('Choose from library')

    expect(
      await screen.findByRole('radio', { name: 'Front photo, ready, earlier photo kept' }),
    ).toBeOnTheScreen()
    expect(screen.getByTestId('thumb-front').props.source).toEqual({
      uri: `https://signed.example/${uuid(50)}?token=1`,
    })
    expect(serverPhotos.map((p) => p.id)).toEqual([uuid(50)])
  })

  it('gives a different photo a new id, even after a failure', async () => {
    mockUploadPhoto.mockRejectedValueOnce(new AppError('NETWORK'))
    libraryGives('front')
    await openPhotos()
    await pressButton('Choose from library')
    await screen.findByText(OFFLINE)

    libraryGives('front', 'b')
    await pressButton('Choose from library')

    await screen.findByRole('radio', { name: 'Front photo, ready' })
    expect(uploadCall(0).id).toBe(uuid(1))
    expect(uploadCall(1).id).toBe(uuid(2))
  })

  it('gives every new photo a new id', async () => {
    libraryGives('front')
    await openPhotos()
    await pressButton('Choose from library')
    await screen.findByRole('radio', { name: 'Front photo, ready' })

    libraryGives('front', 'b')
    await fireEvent.press(tile('Front photo, ready'))
    await pressButton('Choose from library')

    await waitFor(() => expect(mockUploadPhoto).toHaveBeenCalledTimes(2))
    expect(uploadCall(0).id).toBe(uuid(1))
    expect(uploadCall(1).id).toBe(uuid(2))
  })

  it('shows the rate-limit message, and lets the same photo be sent again', async () => {
    mockUploadPhoto.mockRejectedValueOnce(new AppError('RATE_LIMITED'))
    libraryGives('front')
    await openPhotos()

    await pressButton('Choose from library')

    expect(await screen.findByText('Take a short break and try again')).toBeOnTheScreen()
    await pressButton('Try again')
    expect(await screen.findByRole('radio', { name: 'Front photo, ready' })).toBeOnTheScreen()
    expect(uploadCall(1).id).toBe(uuid(1))
  })

  it('gives the quality guidance when the server refuses the photo, and asks for a new one', async () => {
    serverPhotos = [readyPhoto('front', uuid(50))]
    mockUploadPhoto.mockRejectedValueOnce(new AppError('PHOTO_QUALITY'))
    libraryGives('front')
    await openPhotos()
    await screen.findByRole('radio', { name: 'Front photo, ready' })

    await pressButton('Choose from library')

    expect(
      await screen.findByText('That photo didn’t pass our quality check — try again in daylight'),
    ).toBeOnTheScreen()
    expect(screen.getByText(GUIDANCE)).toBeOnTheScreen()
    expect(tile('Front photo, ready, earlier photo kept')).toBeOnTheScreen()
    // The same photo would be refused again.
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()

    libraryGives('front', 'b')
    await pressButton('Choose from library')
    await waitFor(() => expect(mockUploadPhoto).toHaveBeenCalledTimes(2))
    expect(uploadCall(1).id).toBe(uuid(2))
  })

  it('says something friendly for any other failure, and lets the same photo be tried again', async () => {
    mockUploadPhoto.mockRejectedValueOnce(new AppError('UNKNOWN'))
    libraryGives('front')
    await openPhotos()

    await pressButton('Choose from library')

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeOnTheScreen()
    await pressButton('Try again')
    await screen.findByRole('radio', { name: 'Front photo, ready' })
    expect(uploadCall(1).id).toBe(uuid(1))
  })

  it('asks the server even when the device thinks it is offline, and reports a failure at once', async () => {
    mockUploadPhoto.mockRejectedValueOnce(new AppError('NETWORK'))
    libraryGives('front')
    await openPhotos()
    onlineManager.setOnline(false)

    await pressButton('Choose from library')

    expect(await screen.findByText(OFFLINE)).toBeOnTheScreen()
    expect(mockUploadPhoto).toHaveBeenCalledTimes(1)
  })

  it('deletes the photo it gave up on once another is saved for the view', async () => {
    mockUploadPhoto.mockRejectedValueOnce(new AppError('NETWORK'))
    libraryGives('front')
    await openPhotos()
    await pressButton('Choose from library')
    await screen.findByText(OFFLINE)
    // Until the view has a photo, the one that failed may still be wanted.
    expect(mockDeletePhoto).not.toHaveBeenCalled()

    libraryGives('front', 'b')
    await pressButton('Choose from library')

    await screen.findByRole('radio', { name: 'Front photo, ready' })
    await waitFor(() => expect(mockDeletePhoto).toHaveBeenCalledTimes(1))
    // The first photo may have been left pending on the server, where it counts towards the limit.
    expect(mockDeletePhoto).toHaveBeenCalledWith(fake.client, uuid(1))
  })

  it('deletes a photo the server refused once another is saved for the view', async () => {
    mockUploadPhoto.mockRejectedValueOnce(new AppError('PHOTO_QUALITY'))
    libraryGives('front')
    await openPhotos()
    await pressButton('Choose from library')
    await screen.findByText('That photo didn’t pass our quality check — try again in daylight')

    libraryGives('front', 'b')
    await pressButton('Choose from library')

    await waitFor(() => expect(mockDeletePhoto).toHaveBeenCalledWith(fake.client, uuid(1)))
    expect(mockDeletePhoto).toHaveBeenCalledTimes(1)
  })

  it('deletes nothing when the same photo is sent again', async () => {
    mockUploadPhoto.mockRejectedValueOnce(new AppError('NETWORK'))
    libraryGives('front')
    await openPhotos()
    await pressButton('Choose from library')
    await screen.findByText(OFFLINE)

    await pressButton('Try again')

    await screen.findByRole('radio', { name: 'Front photo, ready' })
    expect(mockDeletePhoto).not.toHaveBeenCalled()
  })

  it('does not mind when a photo it gave up on cannot be deleted', async () => {
    mockDeletePhoto.mockRejectedValue(new AppError('NETWORK'))
    mockUploadPhoto.mockRejectedValueOnce(new AppError('NETWORK'))
    libraryGives('front')
    await openPhotos()
    await pressButton('Choose from library')
    await screen.findByText(OFFLINE)

    libraryGives('front', 'b')
    await pressButton('Choose from library')

    expect(await screen.findByRole('radio', { name: 'Front photo, ready' })).toBeOnTheScreen()
    await waitFor(() => expect(mockDeletePhoto).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('auth-problem')).toBeNull()
  })

  it('asks Auth whether the session is gone when the server says UNAUTHENTICATED, and leads to sign-in if it is', async () => {
    mockCheckSession.mockResolvedValue('rejected')
    mockUploadPhoto.mockRejectedValueOnce(new AppError('UNAUTHENTICATED'))
    libraryGives('front')
    const router = await openPhotos()

    await pressButton('Choose from library')

    expect(await screen.findByText('Sign-in screen')).toBeOnTheScreen()
    expect(mockCheckSession).toHaveBeenCalledWith(fake.client)
    expect(router.getPathname()).toBe('/sign-in')
  })

  it('keeps the screen when Auth says the session is fine', async () => {
    mockCheckSession.mockResolvedValue('valid')
    mockUploadPhoto.mockRejectedValueOnce(new AppError('UNAUTHENTICATED'))
    libraryGives('front')
    await openPhotos()

    await pressButton('Choose from library')

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeOnTheScreen()
    await waitFor(() => expect(mockCheckSession).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Sign-in screen')).toBeNull()
  })

  it('refreshes the photos after an upload', async () => {
    libraryGives('front')
    await openPhotos()
    await screen.findByRole('radio', { name: 'Front photo, not added' })

    await pressButton('Choose from library')
    await screen.findByRole('radio', { name: 'Front photo, ready' })

    await waitFor(() => expect(mockListPhotos.mock.calls.length).toBeGreaterThanOrEqual(2))
    expect(queryClient?.getQueryData<PetPhoto[]>(['photos', PET_ID])).toEqual(serverPhotos)
  })
})

describe('S02 camera access is off', () => {
  const denied = { status: 'denied', granted: false, canAskAgain: false, expires: 'never' }

  it('explains it in a card, and offers the photo library instead', async () => {
    mockPermission = denied
    libraryGives('front')
    await openPhotos()

    await pressButton('Take photo')

    const card = await screen.findByTestId('camera-off')
    expect(within(card).getByRole('header', { name: 'Camera access is off' })).toBeOnTheScreen()
    expect(within(card).getByTestId('card-gradient').props.colors[0]).toBe(
      processColor(cardRoles.warning.from),
    )
    expect(screen.queryByTestId('camera-view')).toBeNull()

    await pressButton('Upload photos instead')

    await waitFor(() => expect(mockLaunchImageLibrary).toHaveBeenCalledTimes(1))
    // The photo goes the same way as one from the library button, and the card goes away.
    expect(await screen.findByRole('radio', { name: 'Front photo, ready' })).toBeOnTheScreen()
    expect(uploadCall(0)).toEqual(expect.objectContaining({ view: 'front', id: uuid(1) }))
    expect(screen.queryByTestId('camera-off')).toBeNull()
  })

  it('stays open when the picker is closed without a photo', async () => {
    mockPermission = denied
    mockLaunchImageLibrary.mockResolvedValueOnce({ canceled: true, assets: null })
    await openPhotos()
    await pressButton('Take photo')
    await screen.findByTestId('camera-off')

    await pressButton('Upload photos instead')

    await waitFor(() => expect(mockLaunchImageLibrary).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('camera-off')).toBeOnTheScreen()
    expect(mockUploadPhoto).not.toHaveBeenCalled()
  })

  it('leads to Settings when the camera can no longer be asked for, and can be closed', async () => {
    mockPermission = denied
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined)
    await openPhotos()
    await pressButton('Take photo')
    await screen.findByTestId('camera-off')

    await pressButton('Open Settings')
    expect(openSettings).toHaveBeenCalledTimes(1)

    await pressButton('Cancel')
    await waitFor(() => expect(screen.queryByTestId('camera-off')).toBeNull())
    expect(mockRequestPermission).not.toHaveBeenCalled()
    openSettings.mockRestore()
  })

  it('asks for the camera when it can, and shows the camera once it is allowed', async () => {
    mockPermission = { status: 'undetermined', granted: false, canAskAgain: true, expires: 'never' }
    mockRequestPermission.mockResolvedValue({
      status: 'granted',
      granted: true,
      canAskAgain: true,
      expires: 'never',
    })
    await openPhotos()

    await pressButton('Take photo')

    expect(await screen.findByTestId('camera-view')).toBeOnTheScreen()
    expect(mockRequestPermission).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('camera-off')).toBeNull()
  })

  it('shows the card when the person refuses the camera', async () => {
    mockPermission = { status: 'undetermined', granted: false, canAskAgain: true, expires: 'never' }
    mockRequestPermission.mockResolvedValue(denied)
    await openPhotos()

    await pressButton('Take photo')

    expect(await screen.findByTestId('camera-off')).toBeOnTheScreen()
    expect(screen.queryByTestId('camera-view')).toBeNull()
  })
})

describe('the camera', () => {
  const granted = { status: 'granted', granted: true, canAskAgain: true, expires: 'never' }

  it('takes a photo for the selected view, and uploads it', async () => {
    mockPermission = granted
    mockTakePicture.mockResolvedValue({
      uri: 'file:///camera/front.jpg',
      width: 3024,
      height: 4032,
    })
    await openPhotos()
    await fireEvent.press(tile('Front photo, not added'))

    await pressButton('Take photo')
    expect(await screen.findByTestId('camera-view')).toBeOnTheScreen()
    expect(screen.getByRole('header', { name: 'Front photo' })).toBeOnTheScreen()
    await pressButton('Take front photo')

    expect(await screen.findByRole('radio', { name: 'Front photo, ready' })).toBeOnTheScreen()
    expect(uploadCall(0)).toEqual(expect.objectContaining({ view: 'front', id: uuid(1) }))
    expect(screen.queryByTestId('camera-view')).toBeNull()
  })

  it('can be closed without a photo', async () => {
    mockPermission = granted
    await openPhotos()
    await pressButton('Take photo')
    await screen.findByTestId('camera-view')

    await pressButton('Cancel')

    await waitFor(() => expect(screen.queryByTestId('camera-view')).toBeNull())
    expect(mockTakePicture).not.toHaveBeenCalled()
    expect(mockUploadPhoto).not.toHaveBeenCalled()
  })

  it('says so when the picture cannot be taken, and stays open', async () => {
    mockPermission = granted
    mockTakePicture.mockRejectedValue(new Error('camera not ready'))
    await openPhotos()
    await pressButton('Take photo')
    await screen.findByTestId('camera-view')

    await pressButton('Take front photo')

    expect(
      await screen.findByText('We couldn’t take that photo. Please try again.'),
    ).toBeOnTheScreen()
    expect(screen.getByTestId('camera-view')).toBeOnTheScreen()
    expect(mockUploadPhoto).not.toHaveBeenCalled()
  })

  it('offers the photo library when the device has no camera to show', async () => {
    mockPermission = granted
    libraryGives('front')
    await openPhotos()
    await pressButton('Take photo')
    const camera = await screen.findByTestId('camera-view')

    await act(async () =>
      camera.props.onMountError({ nativeEvent: { message: 'Camera not available on simulator' } }),
    )

    const card = await screen.findByTestId('camera-off')
    expect(within(card).getByRole('header', { name: 'Camera isn’t available' })).toBeOnTheScreen()
    expect(screen.queryByTestId('camera-view')).toBeNull()
    await pressButton('Upload photos instead')
    expect(await screen.findByRole('radio', { name: 'Front photo, ready' })).toBeOnTheScreen()
  })
})

describe('on the web', () => {
  it('has no camera view: the person chooses a photo, which the browser lets them take', async () => {
    jest.replaceProperty(Platform, 'OS', 'web')
    libraryGives('front')
    await openPhotos()

    expect(screen.queryByRole('button', { name: 'Take photo' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Choose from library' })).toBeNull()

    await pressButton('Upload photo')

    expect(await screen.findByRole('radio', { name: 'Front photo, ready' })).toBeOnTheScreen()
    expect(mockLaunchImageLibrary).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('camera-view')).toBeNull()
    expect(mockRequestPermission).not.toHaveBeenCalled()
  })
})

describe('Use test photo (end-to-end builds only)', () => {
  it('is not there in a production build', async () => {
    env.e2e = false
    await openPhotos()

    expect(screen.queryByRole('button', { name: 'Use test photo' })).toBeNull()
    expect(screen.queryByText('Use test photo')).toBeNull()
  })

  it('is there when the end-to-end seam is on', async () => {
    env.e2e = true
    await openPhotos()

    expect(button('Use test photo')).toBeOnTheScreen()
  })

  it('says so when the test photo cannot be fetched', async () => {
    env.e2e = true
    mockAssetDownload.mockImplementationOnce(() => {
      throw new Error('dev server unreachable')
    })
    await openPhotos()

    await pressButton('Use test photo')

    expect(
      await screen.findByText('We couldn’t open your photos. Please try again.'),
    ).toBeOnTheScreen()
    expect(mockUploadPhoto).not.toHaveBeenCalled()
  })

  it('feeds the fixture for the tile through the same check and upload path', async () => {
    env.e2e = true
    await openPhotos()

    await pressButton('Use test photo')

    expect(await screen.findByRole('radio', { name: 'Front photo, ready' })).toBeOnTheScreen()
    expect(uploadCall(0)).toEqual(expect.objectContaining({ view: 'front', id: uuid(1) }))
    expect(isFixture(uploadCall(0).jpeg, 'front')).toBe(true)
    // The bundled file, as `expo-asset` put it on the device.
    expect(mockManipulate).toHaveBeenCalledWith('file:///bundle/front.jpg', expect.anything())

    // The seam moved on to the next view, with its own fixture.
    await waitFor(() => expect(tile('Side photo, not added', true)).toBeOnTheScreen())
    await pressButton('Use test photo')
    await screen.findByRole('radio', { name: 'Side photo, ready' })
    expect(isFixture(uploadCall(1).jpeg, 'side')).toBe(true)

    await pressButton('Use test photo')
    await screen.findByRole('radio', { name: 'Markings photo, ready' })
    expect(isFixture(uploadCall(2).jpeg, 'markings')).toBe(true)
    expect(await screen.findByRole('button', { name: 'Done' })).toBeOnTheScreen()
  })
})

describe('usePhotoUpload', () => {
  async function renderUpload(options?: Parameters<typeof usePhotoUpload>[1]) {
    const { client } = fakeClient({ userId: 'u1' })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestProviders client={client}>{children}</TestProviders>
    )
    const hook = await renderHook(() => usePhotoUpload(PET_ID, options), { wrapper })
    await waitFor(() => expect(hook.result.current).not.toBeNull())
    return hook.result
  }

  it('walks a view from idle through checking and uploading to ready', async () => {
    const finishCheck = holdNextCheck()
    const finishUpload = holdNextUpload()
    const result = await renderUpload()
    expect(result.current.state).toEqual({
      front: 'idle',
      side: 'idle',
      markings: 'idle',
      extra: 'idle',
    })

    await act(async () => {
      void result.current.upload('front', 'file:///library/a/front.jpg')
    })
    expect(result.current.state.front).toBe('checking')
    expect(result.current.state.side).toBe('idle')

    await act(async () => finishCheck())
    await waitFor(() => expect(result.current.state.front).toBe('uploading'))

    await act(async () => finishUpload())
    await waitFor(() => expect(result.current.state.front).toBe('ready'))
    expect(result.current.problem).toEqual({})
  })

  it('keeps the previous ready photo in its state when a new one fails, and says why', async () => {
    serverPhotos = [readyPhoto('front', uuid(50))]
    const result = await renderUpload()
    await waitFor(() => expect(result.current.state.front).toBe('ready'))

    // A blurry photo: it fails the check on the device.
    await act(async () => result.current.upload('front', 'file:///library/a/blurry.jpg'))
    expect(result.current.state.front).toBe('ready')
    expect(result.current.problem.front).toBe('BLURRY')

    // A good photo that fails to upload.
    mockUploadPhoto.mockRejectedValueOnce(new AppError('NETWORK'))
    await act(async () => result.current.upload('front', 'file:///library/a/front.jpg'))
    expect(result.current.state.front).toBe('ready')
    expect(result.current.problem.front).toBe('NETWORK')

    // A view with no photo of its own is in error instead.
    await act(async () => result.current.upload('side', 'file:///library/a/blurry.jpg'))
    expect(result.current.state.side).toBe('error')
    expect(result.current.problem.side).toBe('BLURRY')
    expect(result.current.state.markings).toBe('idle')
  })

  it('says which view was saved, and nothing when a photo is not', async () => {
    const onSaved = jest.fn()
    const result = await renderUpload({ onSaved })

    await act(async () => result.current.upload('side', 'file:///library/a/blurry.jpg'))
    mockUploadPhoto.mockRejectedValueOnce(new AppError('NETWORK'))
    await act(async () => result.current.upload('side', 'file:///library/a/side.jpg'))
    expect(onSaved).not.toHaveBeenCalled()

    await act(async () => result.current.retry('side'))
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onSaved).toHaveBeenCalledWith('side')
    expect(uploadCall(1).id).toBe(uploadCall(0).id)
  })

  it('has nothing to retry for a photo that was never sent', async () => {
    const result = await renderUpload()

    await act(async () => result.current.retry('front'))
    await act(async () => result.current.upload('front', 'file:///library/a/blurry.jpg'))
    await act(async () => result.current.retry('front'))

    expect(mockUploadPhoto).not.toHaveBeenCalled()
  })

  it('ignores a second upload for a view while one is running', async () => {
    mockUploadPhoto.mockImplementation(() => new Promise(() => undefined))
    const result = await renderUpload()

    await act(async () => {
      void result.current.upload('front', 'file:///library/a/front.jpg')
      void result.current.upload('front', 'file:///library/b/front.jpg')
    })
    await waitFor(() => expect(result.current.state.front).toBe('uploading'))

    expect(mockUploadPhoto).toHaveBeenCalledTimes(1)
    expect(mockRandomUUID).toHaveBeenCalledTimes(1)
  })
})
