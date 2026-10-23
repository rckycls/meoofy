import { Dimensions, StyleSheet, Text } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'
import { deleteAccount, getProfile, signOut, updateDisplayName, type Profile } from '@pawpin/api'
import { AppError } from '@pawpin/core'
import { colors } from '@pawpin/ui'

import AuthLayout from '../../../app/(auth)/_layout'
import YourName from '../../../app/(auth)/your-name'
import TabsLayout from '../../../app/(tabs)/_layout'
import AccountTab from '../../../app/(tabs)/account'
import { fakeClient } from '../../testing/fakeClient'
import { testRootStackLayout } from '../../testing/TestRoot'
import { setWindowWidth } from '../../testing/window'

jest.mock('@pawpin/api', () => {
  const actual = jest.requireActual<typeof import('@pawpin/api')>('@pawpin/api')
  return {
    ...actual,
    getProfile: jest.fn(),
    updateDisplayName: jest.fn(),
    deleteAccount: jest.fn(),
    // The real sign-out runs against the fake client, which ends the session.
    signOut: jest.fn(actual.signOut),
    checkSession: jest.fn(async () => 'unknown'),
  }
})
const mockGetProfile = jest.mocked(getProfile)
const mockUpdateDisplayName = jest.mocked(updateDisplayName)
const mockDeleteAccount = jest.mocked(deleteAccount)
const mockSignOut = jest.mocked(signOut)

const alex: Profile = {
  id: 'u1',
  displayName: 'Alex',
  onboardingPath: 'owner',
  onboardingCompletedAt: '2026-10-01T00:00:00Z',
}

let serverProfile: Profile
let fake: ReturnType<typeof fakeClient>
let queryClient: QueryClient | null = null

function AccountWithCache() {
  queryClient = useQueryClient()
  return <AccountTab />
}

function stub(label: string) {
  return function Stub() {
    return <Text>{label}</Text>
  }
}

/** Opens Account for a signed-in person; `null` is a session with no email. */
async function open(email: string | null = 'alex@example.com') {
  queryClient = null
  fake = fakeClient({ userId: 'u1', email: email ?? undefined })
  const router = await renderRouter(
    {
      _layout: testRootStackLayout(fake.client),
      '(tabs)/_layout': TabsLayout,
      '(tabs)/home': stub('Home screen'),
      '(tabs)/account': AccountWithCache,
      '(auth)/_layout': AuthLayout,
      '(auth)/sign-in': stub('Sign-in screen'),
      '(auth)/your-name': YourName,
    },
    { initialUrl: '/account' },
  )
  return router
}

const pressButton = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }))

async function openDeleteDialog() {
  await screen.findByText('alex@example.com')
  await pressButton('Delete account')
  return screen.findByLabelText('Delete your account?')
}

/** Data the account owns in the cache that no mounted screen is reading. */
function seedCache() {
  queryClient?.setQueryData(['pets'], [{ id: 'p1', name: 'Milo' }])
  queryClient?.setQueryData(['entitlement'], { tier: 'free', petLimit: 3, activePets: 1 })
}
const cacheIsEmpty = () =>
  queryClient?.getQueryData(['pets']) === undefined &&
  queryClient?.getQueryData(['entitlement']) === undefined

const CONFIRM = 'Yes, delete my account'

beforeEach(async () => {
  await AsyncStorage.clear()
  serverProfile = alex
  mockGetProfile.mockReset().mockImplementation(async () => serverProfile)
  mockUpdateDisplayName.mockReset().mockImplementation(async (_client, name) => {
    serverProfile = { ...serverProfile, displayName: name.trim() }
  })
  mockDeleteAccount.mockReset().mockResolvedValue(undefined)
  mockSignOut.mockClear()
})

const initialWindow = Dimensions.get('window')
afterEach(() => setWindowWidth(initialWindow.width, initialWindow.height))

describe('Account', () => {
  it('shows the name and the email', async () => {
    await open()

    expect(await screen.findByRole('header', { name: 'Account' })).toBeOnTheScreen()
    expect(await screen.findByText('Alex')).toBeOnTheScreen()
    expect(screen.getByText('alex@example.com')).toBeOnTheScreen()
  })

  it('says so when the session carries no email', async () => {
    await open(null)

    expect(await screen.findByText('Alex')).toBeOnTheScreen()
    expect(screen.getByText('No email on file')).toBeOnTheScreen()
  })

  it('shows a placeholder while the name loads and a note when it has none', async () => {
    mockGetProfile.mockResolvedValue({ ...alex, displayName: '  ' })
    await open()

    expect(await screen.findByText('Not set')).toBeOnTheScreen()
  })

  it('still offers everything when the profile cannot be read', async () => {
    mockGetProfile.mockRejectedValue(new AppError('UNKNOWN'))
    await open()

    expect(await screen.findByText('Couldn’t load your name')).toBeOnTheScreen()
    expect(screen.getByText('alex@example.com')).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeOnTheScreen()
  })

  it('keeps its controls at least 44 pt tall', async () => {
    await open()
    await screen.findByText('Alex')

    for (const name of ['Edit name', 'Sign out', 'Delete account']) {
      const button = screen.getByRole('button', { name })
      expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(44)
    }
  })

  it('is tinted for the owner flow', async () => {
    await open()
    await screen.findByText('Alex')

    expect(screen.getByTestId('glow-a', { includeHiddenElements: true })).toHaveStyle({
      backgroundColor: '#FFF2AE',
    })
  })
})

describe('Edit name', () => {
  it('opens the name step prefilled with the current name, and saving returns to Account', async () => {
    const router = await open()
    await screen.findByText('Alex')

    await pressButton('Edit name')

    await waitFor(() => expect(router.getPathname()).toBe('/your-name'))
    expect(router.getSearchParams()).toEqual({ mode: 'edit' })
    const field = await screen.findByLabelText('Your name')
    await waitFor(() => expect(field.props.value).toBe('Alex'))

    await fireEvent.changeText(field, 'Al')
    await pressButton('Save')

    await waitFor(() => expect(mockUpdateDisplayName).toHaveBeenCalledWith(fake.client, 'Al'))
    await waitFor(() => expect(router.getPathname()).toBe('/account'))
    // The new name is read back, so Account shows it without another load.
    expect(await screen.findByText('Al')).toBeOnTheScreen()
    expect(screen.queryByText('Alex')).toBeNull()
  })
})

describe('Sign out', () => {
  it('signs out, and the tab layout leads to sign-in', async () => {
    const router = await open()
    await screen.findByText('Alex')

    await pressButton('Sign out')

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledWith(fake.client))
    expect(await screen.findByText('Sign-in screen')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/sign-in')
  })

  it('signs out once however fast it is pressed', async () => {
    mockSignOut.mockImplementationOnce(() => new Promise(() => undefined))
    await open()
    await screen.findByText('Alex')
    const button = screen.getByRole('button', { name: 'Sign out' })

    await act(async () => {
      void fireEvent.press(button)
      void fireEvent.press(button)
    })

    expect(mockSignOut).toHaveBeenCalledTimes(1)
  })

  it('stays on Account with a friendly note when signing out fails', async () => {
    mockSignOut.mockRejectedValueOnce(new AppError('UNKNOWN'))
    const router = await open()
    await screen.findByText('Alex')

    await pressButton('Sign out')

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/account')
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled()
  })
})

describe('Delete account', () => {
  it('asks first, in a labelled dialog, and deletes nothing until it is confirmed', async () => {
    await open()

    const dialog = await openDeleteDialog()
    expect(dialog).toBeOnTheScreen()
    const inDialog = within(dialog)
    expect(inDialog.getByRole('header', { name: 'Delete your account?' })).toBeOnTheScreen()
    expect(
      inDialog.getByText(
        'This permanently deletes your account, your pets and their photos. It can’t be undone.',
      ),
    ).toBeOnTheScreen()
    expect(inDialog.getByRole('button', { name: 'Cancel' })).toBeOnTheScreen()
    expect(mockDeleteAccount).not.toHaveBeenCalled()
  })

  it('marks the dialog as modal and gives the destructive action the urgent button', async () => {
    await open()

    const dialog = await openDeleteDialog()

    expect(dialog.props.role).toBe('alertdialog')
    expect(dialog.props['aria-modal']).toBe(true)
    expect(dialog.props.accessibilityViewIsModal).toBe(true)
    const confirm = within(dialog).getByRole('button', { name: CONFIRM })
    expect(confirm).toHaveStyle({ backgroundColor: colors.deepBlue })
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    expect(cancel).toHaveStyle({ backgroundColor: colors.white })
    expect(StyleSheet.flatten(confirm.props.style).minHeight).toBeGreaterThanOrEqual(44)
  })

  it('closes on Cancel without deleting', async () => {
    await open()
    const dialog = await openDeleteDialog()

    await fireEvent.press(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByLabelText('Delete your account?')).toBeNull())
    expect(mockDeleteAccount).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeOnTheScreen()
  })

  it('deletes on confirmation, clears the query cache and goes to sign-in', async () => {
    const router = await open()
    const dialog = await openDeleteDialog()
    seedCache()
    expect(cacheIsEmpty()).toBe(false)

    await fireEvent.press(within(dialog).getByRole('button', { name: CONFIRM }))

    await waitFor(() => expect(mockDeleteAccount).toHaveBeenCalledWith(fake.client))
    expect(await screen.findByText('Sign-in screen')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/sign-in')
    // The session is still open here (the mocked call does not end it), so only the
    // screen's own clear can have emptied the cache.
    expect(fake.auth.signOut).not.toHaveBeenCalled()
    expect(cacheIsEmpty()).toBe(true)
  })

  it('treats an UNAUTHENTICATED answer as a deletion that already happened', async () => {
    // A retry after a success: the account and its session are gone, so the server says 401.
    mockDeleteAccount.mockRejectedValue(new AppError('UNAUTHENTICATED'))
    const router = await open()
    const dialog = await openDeleteDialog()
    seedCache()

    await fireEvent.press(within(dialog).getByRole('button', { name: CONFIRM }))

    expect(await screen.findByText('Sign-in screen')).toBeOnTheScreen()
    expect(mockSignOut).toHaveBeenCalledWith(fake.client)
    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(router.getPathname()).toBe('/sign-in')
    expect(cacheIsEmpty()).toBe(true)
    expect(screen.queryByText(/couldn’t delete/)).toBeNull()
  })

  it('stays on Account with a friendly note when the deletion fails', async () => {
    mockDeleteAccount.mockRejectedValue(new AppError('UNKNOWN'))
    const router = await open()
    const dialog = await openDeleteDialog()
    seedCache()

    await fireEvent.press(within(dialog).getByRole('button', { name: CONFIRM }))

    expect(
      await screen.findByText('We couldn’t delete your account. Please try again.'),
    ).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/account')
    expect(mockSignOut).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Delete your account?')).toBeNull()
    // Nothing was lost: the person is still signed in and their data is still shown.
    expect(screen.getByText('Alex')).toBeOnTheScreen()
    expect(cacheIsEmpty()).toBe(false)
  })

  it('says when the device is offline, and lets the person try again', async () => {
    mockDeleteAccount.mockRejectedValueOnce(new AppError('NETWORK'))
    await open()
    const dialog = await openDeleteDialog()

    await fireEvent.press(within(dialog).getByRole('button', { name: CONFIRM }))

    expect(
      await screen.findByText('You seem to be offline. Check your connection and try again.'),
    ).toBeOnTheScreen()

    const again = await openDeleteDialog()
    await fireEvent.press(within(again).getByRole('button', { name: CONFIRM }))

    expect(await screen.findByText('Sign-in screen')).toBeOnTheScreen()
    expect(mockDeleteAccount).toHaveBeenCalledTimes(2)
  })

  it('deletes once however fast the confirmation is pressed', async () => {
    mockDeleteAccount.mockImplementation(() => new Promise(() => undefined))
    await open()
    const dialog = await openDeleteDialog()
    const confirm = within(dialog).getByRole('button', { name: CONFIRM })

    // Two presses in the same tick, before the screen has re-rendered.
    await act(async () => {
      void fireEvent.press(confirm)
      void fireEvent.press(confirm)
    })

    expect(mockDeleteAccount).toHaveBeenCalledTimes(1)
  })

  it('shows progress and keeps Cancel from closing the dialog mid-delete', async () => {
    mockDeleteAccount.mockImplementation(() => new Promise(() => undefined))
    await open()
    const dialog = await openDeleteDialog()

    await fireEvent.press(within(dialog).getByRole('button', { name: CONFIRM }))

    expect(within(dialog).getByRole('button', { name: CONFIRM })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })
})
