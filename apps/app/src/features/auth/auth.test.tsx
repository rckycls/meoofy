import {
  Dimensions,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  processColor,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as AppleAuthentication from 'expo-apple-authentication'
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library'
import {
  checkSession,
  getProfile,
  sendEmailCode,
  signInWithAppleIdToken,
  signInWithAppleWeb,
  updateDisplayName,
  verifyEmailCode,
  type Profile,
} from '@meoofy/api'
import { AppError } from '@meoofy/core'
import { cardRoles, flowTints } from '@meoofy/ui'

import EmailCode from '../../../app/(auth)/email-code'
import AuthLayout from '../../../app/(auth)/_layout'
import SignIn from '../../../app/(auth)/sign-in'
import YourName from '../../../app/(auth)/your-name'
import EntryIndex from '../../../app/index'
import AllSet from '../../../app/(onboarding)/all-set'
import { env } from '../../env'
import { fakeClient } from '../../testing/fakeClient'
import { sentryReports, turnSentryOff } from '../../testing/sentry'
import { testRootLayout } from '../../testing/TestRoot'
import { setWindowWidth } from '../../testing/window'
import { authCopy } from './copy'

jest.mock('@meoofy/api', () => ({
  ...jest.requireActual('@meoofy/api'),
  sendEmailCode: jest.fn(),
  verifyEmailCode: jest.fn(),
  signInWithAppleIdToken: jest.fn(),
  signInWithAppleWeb: jest.fn(),
  updateDisplayName: jest.fn(),
  getProfile: jest.fn(),
  completeOnboarding: jest.fn(),
  checkSession: jest.fn(),
}))
const mockSendEmailCode = jest.mocked(sendEmailCode)
const mockVerifyEmailCode = jest.mocked(verifyEmailCode)
const mockSignInWithAppleIdToken = jest.mocked(signInWithAppleIdToken)
const mockSignInWithAppleWeb = jest.mocked(signInWithAppleWeb)
const mockUpdateDisplayName = jest.mocked(updateDisplayName)
const mockGetProfile = jest.mocked(getProfile)
const mockCheckSession = jest.mocked(checkSession)

// Ruling 4: no automated test calls the real Apple. The native module is
// replaced; its button is a plain pressable with the name the system button has.
jest.mock('expo-apple-authentication', () => {
  const React = jest.requireActual('react')
  const { Pressable } = jest.requireActual('react-native')
  return {
    AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
    AppleAuthenticationButtonType: { SIGN_IN: 0, CONTINUE: 1, SIGN_UP: 2 },
    AppleAuthenticationButtonStyle: { WHITE: 0, WHITE_OUTLINE: 1, BLACK: 2 },
    isAvailableAsync: jest.fn(async () => true),
    signInAsync: jest.fn(),
    AppleAuthenticationButton: ({ onPress }: { onPress: () => void }) =>
      React.createElement(Pressable, {
        accessibilityRole: 'button',
        accessibilityLabel: 'Continue with Apple',
        onPress,
      }),
  }
})
const mockAppleAvailable = jest.mocked(AppleAuthentication.isAvailableAsync)
const mockAppleSignIn = jest.mocked(AppleAuthentication.signInAsync)

jest.mock('./appleNonce', () => ({
  createNonce: jest.fn(async () => ({ raw: 'raw-nonce', hashed: 'hashed-nonce' })),
}))

const EMAIL = 'alex@example.com'

const alex: Profile = {
  id: 'u1',
  displayName: 'Alex',
  onboardingPath: null,
  onboardingCompletedAt: null,
}

/** What the server holds: `updateDisplayName` changes it, `getProfile` reads it. */
let serverProfile: Profile
let fake: ReturnType<typeof fakeClient>

function stub(label: string) {
  return function Stub() {
    return <Text>{label}</Text>
  }
}

function routes(client: ReturnType<typeof fakeClient>['client']) {
  return {
    _layout: testRootLayout(client),
    // The cold-start gate, which sends a person on once they are signed in.
    index: EntryIndex,
    '(auth)/_layout': AuthLayout,
    '(auth)/sign-in': SignIn,
    '(auth)/email-code': EmailCode,
    '(auth)/your-name': YourName,
    '(onboarding)/all-set': AllSet,
    '(tabs)/home': stub('Home screen'),
    '(tabs)/find': stub('Find screen'),
    '(tabs)/account': stub('Account screen'),
    'pets/new': stub('Add pet screen'),
  }
}

async function render(url: string, userId: string | null = null) {
  fake = fakeClient({ userId })
  const router = await renderRouter(routes(fake.client), { initialUrl: url })
  return router
}

async function openSignIn() {
  const router = await render('/sign-in')
  await screen.findByRole('header', { name: authCopy.signIn.title })
  return router
}

async function typeEmail(value = EMAIL) {
  await fireEvent.changeText(screen.getByLabelText(authCopy.signIn.emailLabel), value)
}

/** From sign-in to the code screen, as a person does it. */
async function openCodeScreen(email = EMAIL) {
  const router = await openSignIn()
  await typeEmail(email)
  await fireEvent.press(screen.getByRole('button', { name: authCopy.signIn.emailAction }))
  await screen.findByRole('header', { name: authCopy.emailCode.title })
  return router
}

const codeInput = () => screen.getByLabelText(authCopy.emailCode.codeLabel)

// Jest's TextInput is a mock class whose `focus` is one shared jest.fn: a call means some field
// was told to take the cursor, and the code field is the only one that is, on these screens.
const focusField = jest.mocked(TextInput.prototype.focus)

async function enterCode(digits: string) {
  await fireEvent.changeText(codeInput(), digits)
}

const press = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }))

beforeEach(async () => {
  await AsyncStorage.clear()
  await AsyncStorage.setItem('meoofy.onboardingSeen', 'true')
  serverProfile = alex

  mockSendEmailCode.mockReset().mockResolvedValue(undefined)
  // A good code signs the person in, which the session layer reports to the app.
  mockVerifyEmailCode.mockReset().mockImplementation(async () => fake.signIn('u1'))
  mockSignInWithAppleIdToken.mockReset().mockImplementation(async () => fake.signIn('u1'))
  mockSignInWithAppleWeb.mockReset().mockResolvedValue(undefined)
  mockUpdateDisplayName.mockReset().mockImplementation(async (_client, name) => {
    serverProfile = { ...serverProfile, displayName: name.trim() }
  })
  mockGetProfile.mockReset().mockImplementation(async () => serverProfile)
  mockCheckSession.mockReset().mockResolvedValue('unknown')

  mockAppleAvailable.mockReset().mockResolvedValue(true)
  mockAppleSignIn.mockReset().mockResolvedValue({
    user: 'apple-user',
    state: null,
    fullName: null,
    email: null,
    realUserStatus: 0,
    identityToken: 'apple-id-token',
    authorizationCode: 'apple-code',
  })
})

const initialWindow = Dimensions.get('window')

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
  turnSentryOff()
  setWindowWidth(initialWindow.width, initialWindow.height)
})

describe('O01 sign in', () => {
  const UNCONFIRMED_DELETION =
    'If you can still sign in, your account wasn’t deleted. Delete it again from Account.'

  it('offers Apple and an email code, and says there is no password', async () => {
    await openSignIn()

    expect(screen.getByText(authCopy.signIn.body)).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Continue with Apple' })).toBeOnTheScreen()
    expect(screen.getByLabelText('Email')).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Sign in with email' })).toBeOnTheScreen()
    expect(screen.queryByText(UNCONFIRMED_DELETION)).toBeNull()
  })

  it('after a deletion the server could not confirm, says how to tell whether it went through', async () => {
    // Ruling 25: Account sends a confirmed deletion that ended in UNAUTHENTICATED here.
    await render('/sign-in?deletion=unconfirmed')

    expect(await screen.findByText(UNCONFIRMED_DELETION)).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Sign in with email' })).toBeOnTheScreen()
  })

  it('sends an unexpected failure while sending the code to Sentry, without its message', async () => {
    const reports = sentryReports()
    mockSendEmailCode.mockRejectedValue(new AppError('UNKNOWN', `could not email ${EMAIL}`))
    await openSignIn()
    await typeEmail()

    await press('Sign in with email')

    expect(await screen.findByText(authCopy.errors.unknown)).toBeOnTheScreen()
    expect(reports()).toEqual(['UNKNOWN in sendEmailCode'])
  })

  it('asks for an email address that is valid, and makes no call without one', async () => {
    await openSignIn()

    await press('Sign in with email')
    expect(await screen.findByText('Enter a valid email address')).toBeOnTheScreen()

    await typeEmail('alex@')
    await press('Sign in with email')
    expect(screen.getByText('Enter a valid email address')).toBeOnTheScreen()
    expect(mockSendEmailCode).not.toHaveBeenCalled()
  })

  it('reads the email problem out as the field hint, and drops it once the person types again', async () => {
    await openSignIn()
    await typeEmail('nope')
    await press('Sign in with email')
    await screen.findByText('Enter a valid email address')
    expect(screen.getByLabelText('Email').props.accessibilityHint).toBe(
      'Enter a valid email address',
    )

    await typeEmail('nope@example.com')

    expect(screen.queryByText('Enter a valid email address')).toBeNull()
  })

  it('sends the code to a valid email (trimmed) and opens the code screen', async () => {
    const router = await openSignIn()
    await typeEmail(`  ${EMAIL} `)

    await press('Sign in with email')

    await waitFor(() => expect(router.getPathname()).toBe('/email-code'))
    expect(mockSendEmailCode).toHaveBeenCalledTimes(1)
    expect(mockSendEmailCode).toHaveBeenCalledWith(fake.client, EMAIL)
    expect(await screen.findByText(authCopy.emailCode.body(EMAIL))).toBeOnTheScreen()
  })

  it('keeps the email address out of the URL', async () => {
    const router = await openCodeScreen()

    expect(router.getPathname()).toBe('/email-code')
    expect(JSON.stringify(router.getSearchParams())).not.toContain('alex')
  })

  it('says "This pilot is invite-only" when the email is not on the list, and stays put', async () => {
    mockSendEmailCode.mockRejectedValue(new AppError('INVITE_ONLY'))
    const router = await openSignIn()
    await typeEmail()

    await press('Sign in with email')

    expect(await screen.findByText('This pilot is invite-only')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/sign-in')
    // The person can try another address straight away.
    expect(screen.getByRole('button', { name: 'Sign in with email' })).toBeEnabled()
  })

  it.each([
    ['RATE_LIMITED', 'Take a short break and try again'],
    ['NETWORK', authCopy.errors.network],
    ['UNKNOWN', authCopy.errors.unknown],
  ] as const)('explains a %s failure while sending the code', async (code, message) => {
    mockSendEmailCode.mockRejectedValue(new AppError(code))
    const router = await openSignIn()
    await typeEmail()

    await press('Sign in with email')

    expect(await screen.findByText(message)).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/sign-in')
  })

  it('treats a VALIDATION answer from the server as a bad email address', async () => {
    mockSendEmailCode.mockRejectedValue(new AppError('VALIDATION'))
    await openSignIn()
    await typeEmail()

    await press('Sign in with email')

    expect(await screen.findByText('Enter a valid email address')).toBeOnTheScreen()
  })

  it('sends someone who is already signed in on to the gate instead of asking again', async () => {
    await render('/sign-in', 'u1')

    expect(await screen.findByText('Home screen')).toBeOnTheScreen()
  })

  it('makes the email field at least 44 pt tall', async () => {
    await openSignIn()

    const field = StyleSheet.flatten(screen.getByLabelText('Email').props.style)
    expect(field.minHeight).toBeGreaterThanOrEqual(44)
  })
})

describe('Sign in with Apple (iOS)', () => {
  const pressApple = () => press('Continue with Apple')

  it('asks Apple for the name and email with the hashed nonce, then signs in with the raw one', async () => {
    await openSignIn()

    await pressApple()

    await waitFor(() => expect(mockSignInWithAppleIdToken).toHaveBeenCalledTimes(1))
    expect(mockAppleSignIn).toHaveBeenCalledWith({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: 'hashed-nonce',
    })
    expect(mockSignInWithAppleIdToken).toHaveBeenCalledWith(
      fake.client,
      'apple-id-token',
      'raw-nonce',
    )
  })

  it('opens Home for a returning, named person through the gate', async () => {
    const router = await openSignIn()

    await pressApple()

    expect(await screen.findByText('Home screen')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/home')
    expect(mockUpdateDisplayName).not.toHaveBeenCalled()
  })

  it('opens Find for a returning person who came in on the finder path', async () => {
    await AsyncStorage.setItem('meoofy.onboardingPath', 'finder')
    await openSignIn()

    await pressApple()

    expect(await screen.findByText('Find screen')).toBeOnTheScreen()
  })

  it('shows nothing when the person cancels Apple’s sheet, and the button works again', async () => {
    mockAppleSignIn.mockRejectedValueOnce(
      Object.assign(new Error('The user canceled the authorization attempt'), {
        code: 'ERR_REQUEST_CANCELED',
      }),
    )
    const router = await openSignIn()

    await pressApple()

    await waitFor(() => expect(mockAppleSignIn).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue with Apple' })).toBeEnabled(),
    )
    expect(mockSignInWithAppleIdToken).not.toHaveBeenCalled()
    expect(screen.queryByTestId('auth-problem')).toBeNull()
    expect(screen.queryByText(authCopy.errors.unknown)).toBeNull()
    expect(router.getPathname()).toBe('/sign-in')

    await pressApple()
    await waitFor(() => expect(mockSignInWithAppleIdToken).toHaveBeenCalledTimes(1))
  })

  it('says "This pilot is invite-only" when Apple’s address is not on the list', async () => {
    mockSignInWithAppleIdToken.mockRejectedValue(new AppError('INVITE_ONLY'))
    await openSignIn()

    await pressApple()

    expect(await screen.findByText('This pilot is invite-only')).toBeOnTheScreen()
  })

  it('explains any other failure in plain words', async () => {
    mockAppleSignIn.mockRejectedValue(
      Object.assign(new Error('boom'), { code: 'ERR_REQUEST_FAILED' }),
    )
    await openSignIn()

    await pressApple()

    expect(await screen.findByText(authCopy.errors.unknown)).toBeOnTheScreen()
  })

  it('names a new person with the first name Apple gave, and greets them on the last screen', async () => {
    serverProfile = { ...alex, displayName: '' }
    mockAppleSignIn.mockResolvedValue({
      user: 'apple-user',
      state: null,
      fullName: {
        givenName: 'Alex',
        familyName: 'Rivera',
        middleName: null,
        namePrefix: null,
        nameSuffix: null,
        nickname: null,
      },
      email: null,
      realUserStatus: 0,
      identityToken: 'apple-id-token',
      authorizationCode: 'apple-code',
    })
    const router = await openSignIn()

    await pressApple()

    expect(await screen.findByText('You’re all set, Alex.')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/all-set')
    expect(mockUpdateDisplayName).toHaveBeenCalledWith(fake.client, 'Alex')
  })

  it('does not rename a person who already has a name', async () => {
    mockAppleSignIn.mockResolvedValue({
      user: 'apple-user',
      state: null,
      fullName: {
        givenName: 'Alexandra',
        familyName: null,
        middleName: null,
        namePrefix: null,
        nameSuffix: null,
        nickname: null,
      },
      email: null,
      realUserStatus: 0,
      identityToken: 'apple-id-token',
      authorizationCode: 'apple-code',
    })
    await openSignIn()

    await pressApple()

    expect(await screen.findByText('Home screen')).toBeOnTheScreen()
    expect(mockUpdateDisplayName).not.toHaveBeenCalled()
  })

  it('asks for a name when Apple gave none and the profile has none', async () => {
    serverProfile = { ...alex, displayName: '' }
    const router = await openSignIn()

    await pressApple()

    expect(
      await screen.findByRole('header', { name: 'What should we call you?' }),
    ).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/your-name')
  })

  it('still signs in when saving the Apple name fails, and asks for a name instead', async () => {
    serverProfile = { ...alex, displayName: '' }
    mockUpdateDisplayName.mockRejectedValue(new AppError('NETWORK'))
    mockAppleSignIn.mockResolvedValue({
      user: 'apple-user',
      state: null,
      fullName: {
        givenName: 'Alex',
        familyName: null,
        middleName: null,
        namePrefix: null,
        nameSuffix: null,
        nickname: null,
      },
      email: null,
      realUserStatus: 0,
      identityToken: 'apple-id-token',
      authorizationCode: 'apple-code',
    })
    await openSignIn()

    await pressApple()

    expect(
      await screen.findByRole('header', { name: 'What should we call you?' }),
    ).toBeOnTheScreen()
  })

  it('hides the Apple button on a device where Sign in with Apple is not available', async () => {
    mockAppleAvailable.mockResolvedValue(false)
    await openSignIn()

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Continue with Apple' })).toBeNull(),
    )
    expect(screen.getByRole('button', { name: 'Sign in with email' })).toBeOnTheScreen()
  })
})

describe('Sign in with Apple (web)', () => {
  it('sends the browser to Apple through Supabase, never the native sheet', async () => {
    jest.replaceProperty(Platform, 'OS', 'web')
    await openSignIn()

    await press('Continue with Apple')

    await waitFor(() => expect(mockSignInWithAppleWeb).toHaveBeenCalledWith(fake.client))
    expect(mockAppleSignIn).not.toHaveBeenCalled()
    expect(mockAppleAvailable).not.toHaveBeenCalled()
  })

  it('shows what went wrong when Supabase refuses', async () => {
    jest.replaceProperty(Platform, 'OS', 'web')
    mockSignInWithAppleWeb.mockRejectedValue(new AppError('NETWORK'))
    await openSignIn()

    await press('Continue with Apple')

    expect(await screen.findByText(authCopy.errors.network)).toBeOnTheScreen()
  })
})

describe('email code', () => {
  it('goes back to sign-in when it is opened without an email (a reload)', async () => {
    const router = await render('/email-code')

    expect(await screen.findByRole('header', { name: authCopy.signIn.title })).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/sign-in')
  })

  it('asks for the 6-digit code that was sent, with the keyboard and autofill for it', async () => {
    await openCodeScreen()

    const input = codeInput()
    expect(input.props.keyboardType).toBe('number-pad')
    expect(input.props.textContentType).toBe('oneTimeCode')
    expect(input.props.autoComplete).toBe('one-time-code')
    expect(StyleSheet.flatten(input.props.style).minHeight).toBeGreaterThanOrEqual(44)
  })

  describe('focus', () => {
    beforeEach(() => focusField.mockClear())

    it('can be tapped on iOS: the field is not drawn at an opacity iOS skips when hit-testing', async () => {
      await openCodeScreen()

      // iOS (Fabric) returns no view for a tap on one whose alpha is below 0.01.
      const { opacity } = StyleSheet.flatten(codeInput().props.style)
      expect(opacity).toBeGreaterThanOrEqual(0.01)
      expect(opacity).toBeLessThan(0.05)
    })

    it('takes the cursor when the boxes are tapped, in case a tap gets past the field', async () => {
      await openCodeScreen()
      focusField.mockClear()

      await fireEvent.press(screen.getByTestId('code-boxes'))

      expect(focusField).toHaveBeenCalledTimes(1)
    })

    it('is not switched off while a code is checked, which would drop the keyboard on iOS', async () => {
      mockVerifyEmailCode.mockReturnValue(new Promise(() => undefined))
      await openCodeScreen()

      await enterCode('123456')

      expect(await screen.findByRole('button', { name: 'Verify code' })).toBeDisabled()
      expect(codeInput().props.editable).not.toBe(false)
    })

    it('drops what is typed while a code is being checked', async () => {
      mockVerifyEmailCode.mockReturnValue(new Promise(() => undefined))
      await openCodeScreen()
      await enterCode('123456')
      await screen.findByRole('button', { name: 'Verify code' })

      await enterCode('654321')

      expect(codeInput()).toHaveDisplayValue('123456')
      expect(mockVerifyEmailCode).toHaveBeenCalledTimes(1)
    })

    it('draws the refused code (S05) on the resilience tint with a yellow note (board 05)', async () => {
      mockVerifyEmailCode.mockRejectedValue(new AppError('UNAUTHENTICATED'))
      await openCodeScreen()
      // The sign-in screen stays mounted under the code screen: the code screen's is the last.
      const gradient = () =>
        screen.getAllByTestId('screen-gradient', { includeHiddenElements: true }).at(-1)!
      expect(gradient().props.colors[0]).toBe(processColor(flowTints.owner.tint))

      await enterCode('123456')
      await screen.findByText('That code didn’t work')

      expect(gradient().props.colors[0]).toBe(processColor(flowTints.resilience.tint))
      expect(screen.getByTestId('card-gradient').props.colors[0]).toBe(
        processColor(cardRoles.attention.from),
      )
    })

    it('comes back to the field after a code is refused, ready for the next try (S05)', async () => {
      mockVerifyEmailCode.mockRejectedValue(new AppError('UNAUTHENTICATED'))
      await openCodeScreen()
      focusField.mockClear()

      await enterCode('123456')
      await screen.findByText('That code didn’t work')

      expect(focusField).toHaveBeenCalledTimes(1)
    })

    it('comes back to the field after a new code was sent', async () => {
      mockVerifyEmailCode.mockRejectedValue(new AppError('UNAUTHENTICATED'))
      await openCodeScreen()
      await enterCode('123456')
      await screen.findByText('That code didn’t work')
      focusField.mockClear()

      await press('Send a new code')
      await screen.findByText(authCopy.emailCode.sentAgain(EMAIL))

      expect(focusField).toHaveBeenCalledTimes(1)
    })

    it('stays where it is when a new code cannot be sent', async () => {
      mockVerifyEmailCode.mockRejectedValue(new AppError('UNAUTHENTICATED'))
      await openCodeScreen()
      await enterCode('123456')
      await screen.findByText('That code didn’t work')
      focusField.mockClear()
      mockSendEmailCode.mockRejectedValue(new AppError('NETWORK'))

      await press('Send a new code')
      await screen.findByText(authCopy.errors.network)

      expect(focusField).not.toHaveBeenCalled()
    })
  })

  it('verifies as soon as six digits are in', async () => {
    await openCodeScreen()

    await enterCode('123456')

    await waitFor(() => expect(mockVerifyEmailCode).toHaveBeenCalledTimes(1))
    expect(mockVerifyEmailCode).toHaveBeenCalledWith(fake.client, EMAIL, '123456')
  })

  it('waits for the sixth digit', async () => {
    await openCodeScreen()

    await enterCode('12345')

    expect(mockVerifyEmailCode).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Verify code' })).toBeDisabled()
  })

  it('keeps only digits, at most six', async () => {
    await openCodeScreen()

    await enterCode('12 a3-4')
    expect(codeInput()).toHaveDisplayValue('1234')

    await enterCode('12345678')
    await waitFor(() => expect(mockVerifyEmailCode).toHaveBeenCalledTimes(1))
    expect(mockVerifyEmailCode).toHaveBeenCalledWith(fake.client, EMAIL, '123456')
  })

  it('also verifies from the button', async () => {
    mockVerifyEmailCode.mockRejectedValueOnce(new AppError('NETWORK'))
    await openCodeScreen()
    await enterCode('123456')
    await screen.findByText(authCopy.errors.network)

    await press('Verify code')

    await waitFor(() => expect(mockVerifyEmailCode).toHaveBeenCalledTimes(2))
  })

  it('opens the name step for a new person, through the gate', async () => {
    serverProfile = { ...alex, displayName: '' }
    const router = await openCodeScreen()

    await enterCode('123456')

    expect(
      await screen.findByRole('header', { name: 'What should we call you?' }),
    ).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/your-name')
  })

  it('opens Home for a returning person, through the gate', async () => {
    const router = await openCodeScreen()

    await enterCode('123456')

    expect(await screen.findByText('Home screen')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/home')
  })

  it('opens Find for a returning person who came in on the finder path', async () => {
    await AsyncStorage.setItem('meoofy.onboardingPath', 'finder')
    await openCodeScreen()

    await enterCode('123456')

    expect(await screen.findByText('Find screen')).toBeOnTheScreen()
  })

  describe('S05, a code that did not work', () => {
    async function refuseCode() {
      mockVerifyEmailCode.mockRejectedValue(new AppError('UNAUTHENTICATED'))
      await openCodeScreen()
      await enterCode('123456')
      await screen.findByText('That code didn’t work')
    }

    it('says so, with "Send a new code" ready to use', async () => {
      await refuseCode()

      expect(screen.getByText('That code didn’t work')).toBeOnTheScreen()
      expect(screen.getByText(authCopy.emailCode.expired.body)).toBeOnTheScreen()
      expect(screen.getByRole('button', { name: 'Send a new code' })).toBeEnabled()
    })

    it('clears the digits so the person can type again', async () => {
      await refuseCode()

      expect(codeInput()).toHaveDisplayValue('')
    })

    it('sends a new code, clears the notice and says it was sent', async () => {
      await refuseCode()
      mockSendEmailCode.mockClear()

      await press('Send a new code')

      await waitFor(() => expect(mockSendEmailCode).toHaveBeenCalledWith(fake.client, EMAIL))
      expect(await screen.findByText(authCopy.emailCode.sentAgain(EMAIL))).toBeOnTheScreen()
      expect(screen.queryByText('That code didn’t work')).toBeNull()
    })

    it('lets the person try the code again without sending a new one', async () => {
      await refuseCode()
      mockVerifyEmailCode.mockImplementation(async () => fake.signIn('u1'))

      await enterCode('654321')

      expect(await screen.findByText('Home screen')).toBeOnTheScreen()
      expect(mockVerifyEmailCode).toHaveBeenLastCalledWith(fake.client, EMAIL, '654321')
    })

    it('keeps the notice if a new code cannot be sent, and explains why', async () => {
      await refuseCode()
      mockSendEmailCode.mockRejectedValue(new AppError('RATE_LIMITED'))

      await press('Send a new code')

      expect(await screen.findByText('Take a short break and try again')).toBeOnTheScreen()
      expect(screen.getByText('That code didn’t work')).toBeOnTheScreen()
    })
  })

  it('sends an unexpected failure while verifying to Sentry, without its message', async () => {
    const reports = sentryReports()
    mockVerifyEmailCode.mockRejectedValue(new AppError('UNKNOWN', `no code for ${EMAIL}`))
    await openCodeScreen()

    await enterCode('123456')

    expect(await screen.findByText(authCopy.errors.unknown)).toBeOnTheScreen()
    expect(reports()).toEqual(['UNKNOWN in verifyEmailCode'])
  })

  it('explains other failures while verifying, and keeps the digits for a retry', async () => {
    mockVerifyEmailCode.mockRejectedValue(new AppError('NETWORK'))
    await openCodeScreen()

    await enterCode('123456')

    expect(await screen.findByText(authCopy.errors.network)).toBeOnTheScreen()
    expect(screen.queryByText('That code didn’t work')).toBeNull()
    expect(codeInput()).toHaveDisplayValue('123456')
  })

  describe('resend', () => {
    // Hosted Auth sends one email per address per 60 seconds.
    it('counts down 60 seconds before a new code can be asked for', async () => {
      jest.useFakeTimers()
      await openCodeScreen()

      expect(screen.getByRole('button', { name: 'Resend code' })).toBeDisabled()
      expect(screen.getByText('You can request a new code in 60s')).toBeOnTheScreen()

      await act(async () => {
        jest.advanceTimersByTime(59_000)
      })
      expect(screen.getByText('You can request a new code in 1s')).toBeOnTheScreen()
      expect(screen.getByRole('button', { name: 'Resend code' })).toBeDisabled()

      await act(async () => {
        jest.advanceTimersByTime(1_000)
      })
      expect(screen.getByRole('button', { name: 'Resend code' })).toBeEnabled()
      expect(screen.queryByText(/You can request a new code in/)).toBeNull()
    })

    it('sends the code again and starts the 60 seconds over', async () => {
      jest.useFakeTimers()
      await openCodeScreen()
      await act(async () => {
        jest.advanceTimersByTime(60_000)
      })
      mockSendEmailCode.mockClear()

      await press('Resend code')

      await waitFor(() => expect(mockSendEmailCode).toHaveBeenCalledTimes(1))
      expect(mockSendEmailCode).toHaveBeenCalledWith(fake.client, EMAIL)
      expect(await screen.findByText(authCopy.emailCode.sentAgain(EMAIL))).toBeOnTheScreen()
      expect(screen.getByText('You can request a new code in 60s')).toBeOnTheScreen()
      expect(screen.getByRole('button', { name: 'Resend code' })).toBeDisabled()
    })

    it('stays open for another try when sending fails', async () => {
      jest.useFakeTimers()
      await openCodeScreen()
      await act(async () => {
        jest.advanceTimersByTime(60_000)
      })
      mockSendEmailCode.mockRejectedValue(new AppError('NETWORK'))

      await press('Resend code')

      expect(await screen.findByText(authCopy.errors.network)).toBeOnTheScreen()
      expect(screen.getByRole('button', { name: 'Resend code' })).toBeEnabled()
    })
  })

  it('goes back to sign-in to use a different email', async () => {
    const router = await openCodeScreen()

    await press('Use a different email')

    await waitFor(() => expect(router.getPathname()).toBe('/sign-in'))
    expect(await screen.findByLabelText(authCopy.signIn.emailLabel)).toBeOnTheScreen()
  })

  it('makes the link back at least 44 pt tall', async () => {
    await openCodeScreen()

    const link = screen.getByRole('button', { name: 'Use a different email' })
    expect(StyleSheet.flatten(link.props.style).minHeight).toBeGreaterThanOrEqual(44)
  })
})

describe('invite-only contact link', () => {
  const SUPPORT = 'help@meoofy.example'

  /** From sign-in to the invite-only refusal, as a stranger meets it. */
  async function refuseStranger() {
    mockSendEmailCode.mockRejectedValue(new AppError('INVITE_ONLY'))
    await openSignIn()
    await typeEmail()
    await press('Sign in with email')
    await screen.findByText(authCopy.errors.inviteOnly)
  }

  afterEach(() => {
    env.supportEmail = null
  })

  it('offers a mailto link under the invite-only message when a support address is set', async () => {
    env.supportEmail = SUPPORT

    await refuseStranger()

    const link = screen.getByRole('link', { name: authCopy.errors.contact })
    expect(link.props.href).toBe(`mailto:${SUPPORT}`)
  })

  it('makes the link at least 44 pt tall', async () => {
    env.supportEmail = SUPPORT

    await refuseStranger()

    const link = screen.getByRole('link', { name: authCopy.errors.contact })
    expect(StyleSheet.flatten(link.props.style).minHeight).toBeGreaterThanOrEqual(44)
  })

  it('opens the mail app with that address when it is pressed', async () => {
    env.supportEmail = SUPPORT
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
    await refuseStranger()

    await fireEvent.press(screen.getByRole('link', { name: authCopy.errors.contact }))

    expect(openURL).toHaveBeenCalledWith(`mailto:${SUPPORT}`)
  })

  it('shows no link when no support address is set', async () => {
    env.supportEmail = null

    await refuseStranger()

    expect(screen.getByText(authCopy.errors.inviteOnly)).toBeOnTheScreen()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByText(authCopy.errors.contact)).toBeNull()
  })

  it('shows the link for a refused Apple address too', async () => {
    env.supportEmail = SUPPORT
    mockSignInWithAppleIdToken.mockRejectedValue(new AppError('INVITE_ONLY'))
    await openSignIn()

    await press('Continue with Apple')

    await screen.findByText(authCopy.errors.inviteOnly)
    expect(screen.getByRole('link', { name: authCopy.errors.contact })).toBeOnTheScreen()
  })

  it('leaves it off every other problem', async () => {
    env.supportEmail = SUPPORT
    mockSendEmailCode.mockRejectedValue(new AppError('RATE_LIMITED'))
    await openSignIn()
    await typeEmail()

    await press('Sign in with email')

    expect(await screen.findByText(authCopy.errors.rateLimited)).toBeOnTheScreen()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('shows it on the code screen too', async () => {
    env.supportEmail = SUPPORT
    mockVerifyEmailCode.mockRejectedValue(new AppError('INVITE_ONLY'))
    await openCodeScreen()

    await enterCode('123456')

    expect(await screen.findByText(authCopy.errors.inviteOnly)).toBeOnTheScreen()
    expect(screen.getByRole('link', { name: authCopy.errors.contact }).props.href).toBe(
      `mailto:${SUPPORT}`,
    )
  })

  it('shows no link on the code screen when no support address is set', async () => {
    mockVerifyEmailCode.mockRejectedValue(new AppError('INVITE_ONLY'))
    await openCodeScreen()

    await enterCode('123456')

    expect(await screen.findByText(authCopy.errors.inviteOnly)).toBeOnTheScreen()
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('your name', () => {
  async function openYourName() {
    serverProfile = { ...alex, displayName: '' }
    const router = await render('/your-name', 'u1')
    await screen.findByRole('header', { name: 'What should we call you?' })
    return router
  }

  const typeName = (value: string) =>
    fireEvent.changeText(screen.getByLabelText(authCopy.yourName.label), value)

  it('asks what to call the person', async () => {
    await openYourName()

    expect(screen.getByText(authCopy.yourName.body)).toBeOnTheScreen()
    expect(screen.getByLabelText('Your name')).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeOnTheScreen()
  })

  it.each([
    ['nothing', ''],
    ['only spaces', '   \t '],
  ])('rejects %s and makes no call', async (_label, value) => {
    await openYourName()
    await typeName(value)

    await press('Continue')

    expect(await screen.findByText('Enter your name')).toBeOnTheScreen()
    expect(screen.getByLabelText('Your name').props.accessibilityHint).toBe('Enter your name')
    expect(mockUpdateDisplayName).not.toHaveBeenCalled()
  })

  it('rejects a name over 40 characters, counting an emoji as one', async () => {
    await openYourName()

    await typeName('A'.repeat(41))
    await press('Continue')
    expect(await screen.findByText('Use 40 characters or fewer')).toBeOnTheScreen()
    expect(mockUpdateDisplayName).not.toHaveBeenCalled()

    await typeName('🐶'.repeat(40))
    await press('Continue')
    await waitFor(() => expect(mockUpdateDisplayName).toHaveBeenCalledTimes(1))
  })

  it('saves "Alex" and opens the last onboarding screen, which greets them by name', async () => {
    const router = await openYourName()
    await typeName('  Alex ')

    await press('Continue')

    await waitFor(() => expect(mockUpdateDisplayName).toHaveBeenCalledWith(fake.client, 'Alex'))
    expect(await screen.findByText('You’re all set, Alex.')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/all-set')
  })

  it('shows what went wrong and stays when saving fails', async () => {
    mockUpdateDisplayName.mockRejectedValue(new AppError('NETWORK'))
    const router = await openYourName()
    await typeName('Alex')

    await press('Continue')

    expect(await screen.findByText(authCopy.errors.network)).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/your-name')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  it('sends an unexpected failure while saving to Sentry, without the name', async () => {
    const reports = sentryReports()
    mockUpdateDisplayName.mockRejectedValue(new AppError('UNKNOWN', 'Failing row contains (Alex)'))
    await openYourName()
    await typeName('Alex')

    await press('Continue')

    expect(await screen.findByText(authCopy.errors.unknown)).toBeOnTheScreen()
    expect(reports()).toEqual(['UNKNOWN in updateDisplayName'])
  })

  it('asks Auth about the session when saving comes back unauthenticated, and signs in again if it is gone', async () => {
    mockUpdateDisplayName.mockRejectedValue(new AppError('UNAUTHENTICATED'))
    mockCheckSession.mockResolvedValue('rejected')
    const router = await openYourName()
    await typeName('Alex')

    await press('Continue')

    await waitFor(() => expect(router.getPathname()).toBe('/sign-in'))
    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('goes to sign-in when nobody is signed in', async () => {
    const router = await render('/your-name')

    expect(await screen.findByRole('header', { name: authCopy.signIn.title })).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/sign-in')
  })
})

describe('your name, edit mode', () => {
  async function openEdit() {
    const router = await render('/your-name?mode=edit', 'u1')
    await screen.findByRole('header', { name: authCopy.yourName.edit.title })
    return router
  }

  const nameField = () => screen.getByLabelText(authCopy.yourName.label)

  it('asks for a new name instead of the first one, prefilled with the current name', async () => {
    await openEdit()

    expect(screen.getByText(authCopy.yourName.edit.body)).toBeOnTheScreen()
    expect(screen.queryByText(authCopy.yourName.title)).toBeNull()
    expect(screen.getByRole('button', { name: 'Save' })).toBeOnTheScreen()
    await waitFor(() => expect(nameField().props.value).toBe('Alex'))
  })

  it('saves the new name and returns to Account, not to the last onboarding screen', async () => {
    const router = await openEdit()
    await waitFor(() => expect(nameField().props.value).toBe('Alex'))
    await fireEvent.changeText(nameField(), 'Al')

    await press('Save')

    await waitFor(() => expect(mockUpdateDisplayName).toHaveBeenCalledWith(fake.client, 'Al'))
    // Opened directly, so there is nothing to go back to: it replaces itself with Account.
    expect(await screen.findByText('Account screen')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/account')
    expect(screen.queryByText(/all set/)).toBeNull()
  })

  it('shows what went wrong and stays when saving fails', async () => {
    mockUpdateDisplayName.mockRejectedValue(new AppError('NETWORK'))
    const router = await openEdit()
    await waitFor(() => expect(nameField().props.value).toBe('Alex'))

    await press('Save')

    expect(await screen.findByText(authCopy.errors.network)).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/your-name')
  })

  it('leaves without saving on Cancel', async () => {
    const router = await openEdit()
    await waitFor(() => expect(nameField().props.value).toBe('Alex'))
    await fireEvent.changeText(nameField(), 'Al')

    await press('Cancel')

    expect(await screen.findByText('Account screen')).toBeOnTheScreen()
    expect(router.getPathname()).toBe('/account')
    expect(mockUpdateDisplayName).not.toHaveBeenCalled()
  })

  it('does not overwrite what was typed when the current name arrives late', async () => {
    let arrive: (profile: Profile) => void = () => undefined
    mockGetProfile.mockImplementation(() => new Promise<Profile>((resolve) => (arrive = resolve)))
    await openEdit()
    expect(nameField().props.value).toBe('')
    await fireEvent.changeText(nameField(), 'Sam')

    await act(async () => arrive(alex))

    expect(nameField().props.value).toBe('Sam')
  })

  it('keeps the first-run step as it was: no Cancel, and it opens the last onboarding screen', async () => {
    serverProfile = { ...alex, displayName: '' }
    const router = await render('/your-name', 'u1')
    await screen.findByRole('header', { name: authCopy.yourName.title })

    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(nameField().props.value).toBe('')
    await fireEvent.changeText(nameField(), 'Alex')
    await press('Continue')

    await waitFor(() => expect(router.getPathname()).toBe('/all-set'))
  })
})

describe('layout', () => {
  it('keeps the content to 560 px on a wide window', async () => {
    setWindowWidth(800)
    await openSignIn()

    expect(screen.getByTestId('content-column')).toHaveStyle({ maxWidth: 560 })
  })

  it('uses the full width on a phone', async () => {
    setWindowWidth(390, 844)
    await openSignIn()

    expect(
      StyleSheet.flatten(screen.getByTestId('content-column').props.style).maxWidth,
    ).toBeUndefined()
  })
})
