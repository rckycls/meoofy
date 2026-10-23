import { Dimensions, StyleSheet, Text } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useReducedMotion } from 'react-native-reanimated'
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'
import { completeOnboarding, getProfile, type Profile } from '@pawpin/api'
import { AppError } from '@pawpin/core'

import OnboardingLayout from '../../../app/(onboarding)/_layout'
import AllSet from '../../../app/(onboarding)/all-set'
import ChoosePath from '../../../app/(onboarding)/choose-path'
import Privacy from '../../../app/(onboarding)/privacy'
import Welcome from '../../../app/(onboarding)/welcome'
import TabsLayout from '../../../app/(tabs)/_layout'
import FindTab from '../../../app/(tabs)/find'
import { fakeClient } from '../../testing/fakeClient'
import { testRootLayout } from '../../testing/TestRoot'
import { setWindowWidth } from '../../testing/window'
import { allSetTitle, onboardingCopy } from './copy'
import { stepTransition } from './transition'

jest.mock('@pawpin/api', () => ({
  ...jest.requireActual('@pawpin/api'),
  getProfile: jest.fn(),
  completeOnboarding: jest.fn(),
  checkSession: jest.fn(),
}))
const mockGetProfile = jest.mocked(getProfile)
const mockCompleteOnboarding = jest.mocked(completeOnboarding)

// Reanimated reads the system Reduce Motion setting once at start-up, so the
// tests replace the hook and flip it per test. Everything else stays real.
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated')
  return { __esModule: true, ...actual, useReducedMotion: jest.fn(() => false) }
})
const mockReduced = jest.mocked(useReducedMotion)

// Decorative layers (the hero art) are hidden from assistive tech, so queries
// for them include hidden elements.
const hidden = { includeHiddenElements: true } as const

const alex: Profile = {
  id: 'u1',
  displayName: 'Alex',
  onboardingPath: null,
  onboardingCompletedAt: null,
}

function stub(label: string) {
  return function Stub() {
    return <Text>{label}</Text>
  }
}

function routes(client: ReturnType<typeof fakeClient>['client'], realTabs: boolean) {
  return {
    _layout: testRootLayout(client),
    '(onboarding)/_layout': OnboardingLayout,
    '(onboarding)/welcome': Welcome,
    '(onboarding)/choose-path': ChoosePath,
    '(onboarding)/privacy': Privacy,
    '(onboarding)/all-set': AllSet,
    '(auth)/sign-in': stub('Sign-in screen'),
    // The real tab layout only knows the tabs that exist so far (Find, Alerts),
    // so it is used just where the layout itself is under test.
    ...(realTabs
      ? {
          '(tabs)/_layout': TabsLayout,
          '(tabs)/find': FindTab,
          '(tabs)/alerts': stub('Alerts screen'),
        }
      : { '(tabs)/find': stub('Find screen') }),
    '(tabs)/home': stub('Home screen'),
    'pets/new': stub('Add pet screen'),
  }
}

async function render(url: string, userId: string | null, realTabs = false) {
  const fake = fakeClient({ userId })
  const router = await renderRouter(routes(fake.client, realTabs), { initialUrl: url })
  return { router, fake }
}

/** An onboarding screen, once the session has been read and the screen is up. */
async function open(url: string, userId: string | null = null) {
  const opened = await render(url, userId)
  await screen.findByTestId('onboarding-top-bar')
  return opened
}

/** Lets the stored-path hook finish: the server call, then removing the key. */
async function flush() {
  await act(async () => {
    // Promise-only work (the storage mock and the faked API call), so a few turns do it.
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
  })
}

const initialWindow = Dimensions.get('window')

beforeEach(async () => {
  await AsyncStorage.clear()
  mockReduced.mockReturnValue(false)
  mockGetProfile.mockReset()
  mockGetProfile.mockResolvedValue(alex)
  mockCompleteOnboarding.mockReset()
  mockCompleteOnboarding.mockResolvedValue(undefined)
  setWindowWidth(390, 844)
})

afterEach(() => setWindowWidth(initialWindow.width, initialWindow.height))

describe('O00 welcome', () => {
  it('shows the promise and the two ways in', async () => {
    await open('/welcome')

    expect(screen.getByText('Every pet deserves a way home.')).toBeOnTheScreen()
    expect(screen.getByText(onboardingCopy.welcome.body)).toBeOnTheScreen()
    for (const chip of onboardingCopy.welcome.chips) {
      expect(screen.getByText(chip)).toBeOnTheScreen()
    }
    expect(screen.getByRole('button', { name: 'Get started' })).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'I found a pet' })).toBeOnTheScreen()
  })

  it('announces the headline as a header and the first of three steps', async () => {
    await open('/welcome')

    expect(screen.getByRole('header', { name: 'Every pet deserves a way home.' })).toBeOnTheScreen()
    expect(screen.getByRole('progressbar', { name: 'Step 1 of 3' })).toBeOnTheScreen()
  })

  it('"Get started" opens the choice of path', async () => {
    const { router } = await open('/welcome')

    await fireEvent.press(screen.getByRole('button', { name: 'Get started' }))

    expect(router.getPathname()).toBe('/choose-path')
    expect(await screen.findByText('How would you like to help?')).toBeOnTheScreen()
  })

  it('"I found a pet" records the finder path and goes on to the promises', async () => {
    const { router } = await open('/welcome')

    await fireEvent.press(screen.getByRole('button', { name: 'I found a pet' }))

    await waitFor(() => expect(router.getPathname()).toBe('/privacy'))
    expect(await AsyncStorage.getItem('pawpin.onboardingPath')).toBe('finder')
  })
})

describe('O01 choose your path', () => {
  async function openChoosePath() {
    const opened = await open('/welcome')
    await fireEvent.press(screen.getByRole('button', { name: 'Get started' }))
    await screen.findByText('How would you like to help?')
    return opened
  }

  it('asks how the person would like to help and says both paths stay open', async () => {
    await openChoosePath()

    expect(screen.getByRole('header', { name: 'How would you like to help?' })).toBeOnTheScreen()
    // Literal strings: no path switching exists in the pilot, so the copy must not promise it.
    expect(screen.getByText('Choose a path now. You can always do both later.')).toBeOnTheScreen()
    expect(screen.queryByText(/switch anytime/)).toBeNull()
  })

  it('selects "Protect my pet" by default', async () => {
    await openChoosePath()

    const protect = screen.getByRole('radio', { name: /Protect my pet/ })
    const help = screen.getByRole('radio', { name: /Help a found pet/ })
    expect(protect.props.accessibilityState).toMatchObject({ selected: true })
    expect(help.props.accessibilityState).toMatchObject({ selected: false })
    expect(screen.getByRole('progressbar', { name: 'Step 2 of 3' })).toBeOnTheScreen()
  })

  it('moves the selection to the card that was chosen', async () => {
    await openChoosePath()

    await fireEvent.press(screen.getByRole('radio', { name: /Help a found pet/ }))

    expect(
      screen.getByRole('radio', { name: /Help a found pet/ }).props.accessibilityState,
    ).toMatchObject({ selected: true })
    expect(
      screen.getByRole('radio', { name: /Protect my pet/ }).props.accessibilityState,
    ).toMatchObject({ selected: false })
  })

  it('stores the finder path when "Help a found pet" is chosen and the person continues', async () => {
    const { router } = await openChoosePath()

    await fireEvent.press(screen.getByRole('radio', { name: /Help a found pet/ }))
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(router.getPathname()).toBe('/privacy'))
    expect(await AsyncStorage.getItem('pawpin.onboardingPath')).toBe('finder')
  })

  it('stores the owner path when the default is kept', async () => {
    const { router } = await openChoosePath()

    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(router.getPathname()).toBe('/privacy'))
    expect(await AsyncStorage.getItem('pawpin.onboardingPath')).toBe('owner')
  })

  it('keeps nothing until Continue is pressed', async () => {
    await openChoosePath()

    await fireEvent.press(screen.getByRole('radio', { name: /Help a found pet/ }))

    expect(await AsyncStorage.getItem('pawpin.onboardingPath')).toBeNull()
  })

  it('goes back to the welcome step', async () => {
    const { router } = await openChoosePath()

    await fireEvent.press(screen.getByRole('button', { name: 'Back' }))

    await waitFor(() => expect(router.getPathname()).toBe('/welcome'))
  })

  it('makes both choices at least 44 pt tall', async () => {
    await openChoosePath()

    for (const name of [/Protect my pet/, /Help a found pet/]) {
      const style = StyleSheet.flatten(screen.getByRole('radio', { name }).props.style)
      expect(style.minHeight).toBeGreaterThanOrEqual(44)
    }
  })
})

describe('O02 private by default', () => {
  it('lists the three promises exactly', async () => {
    await open('/privacy')

    const promises = screen.getAllByTestId('promise')
    expect(promises).toHaveLength(3)
    expect(promises[0]).toHaveTextContent('Owners choose what finders see.')
    expect(promises[1]).toHaveTextContent('Contact stays inside PawPin.')
    expect(promises[2]).toHaveTextContent('No account needed to scan.')
    expect(screen.getByRole('progressbar', { name: 'Step 3 of 3' })).toBeOnTheScreen()
  })

  it('"Sounds good" marks onboarding as seen and opens sign-in', async () => {
    const { router } = await open('/privacy')

    await fireEvent.press(screen.getByRole('button', { name: 'Sounds good' }))

    await waitFor(() => expect(router.getPathname()).toBe('/sign-in'))
    expect(await AsyncStorage.getItem('pawpin.onboardingSeen')).toBe('true')
  })

  it('does not mark onboarding as seen before the last step is done', async () => {
    await open('/privacy')

    expect(await AsyncStorage.getItem('pawpin.onboardingSeen')).toBeNull()
  })

  it('goes back to the choice of path', async () => {
    const { router } = await open('/welcome')
    await fireEvent.press(screen.getByRole('button', { name: 'Get started' }))
    await screen.findByText('How would you like to help?')
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Helpful in public. Private by default.')

    await fireEvent.press(screen.getByRole('button', { name: 'Back' }))

    await waitFor(() => expect(router.getPathname()).toBe('/choose-path'))
  })

  it('goes to the choice of path when it was opened directly, with nothing to go back to', async () => {
    const { router } = await open('/privacy')

    await fireEvent.press(screen.getByRole('button', { name: 'Back' }))

    await waitFor(() => expect(router.getPathname()).toBe('/choose-path'))
  })
})

describe('O03 all set', () => {
  it('greets the person by the name on their profile', async () => {
    await open('/all-set', 'u1')

    expect(await screen.findByText('You’re all set, Alex.')).toBeOnTheScreen()
    expect(screen.getByRole('header', { name: 'You’re all set, Alex.' })).toBeOnTheScreen()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('builds the greeting with a typographic apostrophe and drops a blank name', () => {
    expect(allSetTitle('Alex')).toBe('You’re all set, Alex.')
    expect(allSetTitle('  Alex  ')).toBe('You’re all set, Alex.')
    expect(allSetTitle('')).toBe('You’re all set.')
    expect(allSetTitle(null)).toBe('You’re all set.')
  })

  it('still greets the person when the profile cannot be read', async () => {
    mockGetProfile.mockRejectedValue(new AppError('UNKNOWN'))
    await open('/all-set', 'u1')

    expect(await screen.findByText('You’re all set.')).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Add my first pet' })).toBeOnTheScreen()
  })

  it('"Add my first pet" opens the add-pet form', async () => {
    const { router } = await open('/all-set', 'u1')
    await screen.findByText('You’re all set, Alex.')

    await fireEvent.press(screen.getByRole('button', { name: 'Add my first pet' }))

    await waitFor(() => expect(router.getPathname()).toBe('/pets/new'))
  })

  it('"Explore PawPin" opens Home', async () => {
    const { router } = await open('/all-set', 'u1')
    await screen.findByText('You’re all set, Alex.')

    await fireEvent.press(screen.getByRole('button', { name: 'Explore PawPin' }))

    await waitFor(() => expect(router.getPathname()).toBe('/home'))
  })

  it('"Explore PawPin" opens Find on the finder path', async () => {
    await AsyncStorage.setItem('pawpin.onboardingPath', 'finder')
    const { router } = await open('/all-set', 'u1')
    await screen.findByText('You’re all set, Alex.')
    // The path is recorded and cleared on arrival; Explore still remembers it.
    await waitFor(() => expect(mockCompleteOnboarding).toHaveBeenCalled())

    await fireEvent.press(screen.getByRole('button', { name: 'Explore PawPin' }))

    await waitFor(() => expect(router.getPathname()).toBe('/find'))
  })

  it('bursts confetti at full motion', async () => {
    await open('/all-set', 'u1')
    await screen.findByText('You’re all set, Alex.')

    expect(screen.getByTestId('confetti', hidden)).toBeOnTheScreen()
  })

  it('draws no confetti when the system asks to reduce motion', async () => {
    mockReduced.mockReturnValue(true)
    await open('/all-set', 'u1')
    await screen.findByText('You’re all set, Alex.')

    expect(screen.queryByTestId('confetti', hidden)).toBeNull()
  })
})

describe('recording the onboarding path after the first sign-in', () => {
  it('sends the stored path once and removes the key', async () => {
    await AsyncStorage.setItem('pawpin.onboardingPath', 'owner')
    const { fake } = await open('/all-set', 'u1')

    await waitFor(() => expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1))
    expect(mockCompleteOnboarding).toHaveBeenCalledWith(fake.client, 'owner')
    await flush()
    expect(await AsyncStorage.getItem('pawpin.onboardingPath')).toBeNull()
  })

  it('sends the path once when O03 hands over to the tabs before the call has finished', async () => {
    await AsyncStorage.setItem('pawpin.onboardingPath', 'finder')
    let finish: () => void = () => undefined
    mockCompleteOnboarding.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    )
    const { router } = await render('/all-set', 'u1', true)
    await screen.findByText('You’re all set, Alex.')
    await waitFor(() => expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1))

    // Still sending: Explore remembers the finder path and the tabs open.
    await fireEvent.press(screen.getByRole('button', { name: 'Explore PawPin' }))
    await waitFor(() => expect(router.getPathname()).toBe('/find'))
    await screen.findByText('Scanning arrives in the next pilot build')
    await flush()
    expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1)

    finish()
    await flush()
    expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1)
    expect(await AsyncStorage.getItem('pawpin.onboardingPath')).toBeNull()
  })

  it('does nothing when no path was chosen on this device', async () => {
    await open('/all-set', 'u1')
    await screen.findByText('You’re all set, Alex.')

    expect(mockCompleteOnboarding).not.toHaveBeenCalled()
  })

  it('ignores a stored value that is not a path', async () => {
    await AsyncStorage.setItem('pawpin.onboardingPath', 'wizard')
    await open('/all-set', 'u1')
    await screen.findByText('You’re all set, Alex.')

    expect(mockCompleteOnboarding).not.toHaveBeenCalled()
  })

  it('keeps the key when the call fails, so the next open tries again', async () => {
    await AsyncStorage.setItem('pawpin.onboardingPath', 'finder')
    mockCompleteOnboarding.mockRejectedValue(new AppError('NETWORK'))
    await open('/all-set', 'u1')

    await waitFor(() => expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1))
    await screen.findByText('You’re all set, Alex.')
    expect(await AsyncStorage.getItem('pawpin.onboardingPath')).toBe('finder')
  })

  it('also runs for a signed-in person who lands in the tabs without seeing O03', async () => {
    await AsyncStorage.setItem('pawpin.onboardingPath', 'finder')
    const { fake } = await render('/find', 'u1', true)
    await screen.findByText('Scanning arrives in the next pilot build')

    await waitFor(() => expect(mockCompleteOnboarding).toHaveBeenCalledWith(fake.client, 'finder'))
    await flush()
    expect(await AsyncStorage.getItem('pawpin.onboardingPath')).toBeNull()
  })

  it('never runs for a signed-out visitor', async () => {
    await AsyncStorage.setItem('pawpin.onboardingPath', 'owner')
    await render('/find', null, true)
    await screen.findByText('Sign-in screen')

    expect(mockCompleteOnboarding).not.toHaveBeenCalled()
    expect(await AsyncStorage.getItem('pawpin.onboardingPath')).toBe('owner')
  })
})

describe('hero scenes', () => {
  // The four compositions from board 08. Sparkles are extra decoration.
  const scenes = [
    { url: '/welcome', hero: 'hero-night-garden', stickers: ['dog', 'cat', 'sleepy-moon'] },
    { url: '/choose-path', hero: 'hero-two-paths', stickers: ['dog', 'paw-pin', 'heart-paw'] },
    {
      url: '/privacy',
      hero: 'hero-safe-orbit',
      stickers: ['privacy-shield', 'love-letter', 'sleepy-moon'],
    },
    {
      url: '/all-set',
      hero: 'hero-celebration',
      stickers: ['rainbow', 'pet-tag', 'shooting-star', 'heart-paw'],
    },
  ]

  it.each(scenes)('$hero holds its stickers and hides them from assistive tech', async (scene) => {
    await open(scene.url, 'u1')
    await screen.findByTestId(scene.hero, hidden)

    expect(screen.queryByTestId(scene.hero)).toBeNull()
    for (const name of scene.stickers) {
      expect(screen.getByTestId(`sticker-${name}`, hidden)).toBeOnTheScreen()
      expect(screen.queryByTestId(`sticker-${name}`)).toBeNull()
    }
  })

  it.each(scenes)('$hero is 268 pt tall', async (scene) => {
    await open(scene.url, 'u1')

    expect(screen.getByTestId(scene.hero, hidden)).toHaveStyle({ height: 268 })
  })

  it('draws the paw trail between the dog and the pin', async () => {
    await open('/choose-path')

    expect(screen.getAllByTestId('trail-dot', hidden).length).toBeGreaterThanOrEqual(5)
  })
})

describe('layout', () => {
  it('gives the top bar 48 pt and the copy block 128 pt, with the actions last', async () => {
    await open('/welcome')

    expect(screen.getByTestId('onboarding-top-bar')).toHaveStyle({ minHeight: 48 })
    expect(screen.getByTestId('onboarding-copy')).toHaveStyle({ minHeight: 128 })
    const actions = screen.getByTestId('onboarding-actions')
    expect(within(actions).getAllByRole('button')).toHaveLength(2)
    // The column spreads its two groups, which pins the actions to the bottom.
    expect(screen.getByTestId('content-column')).toHaveStyle({
      flexGrow: 1,
      justifyContent: 'space-between',
    })
  })

  it('caps the content at 560 px from 768 px wide', async () => {
    setWindowWidth(800)
    await open('/welcome')

    expect(screen.getByTestId('content-column')).toHaveStyle({ maxWidth: 560 })
  })

  it('uses the full width on a phone', async () => {
    await open('/welcome')

    expect(
      StyleSheet.flatten(screen.getByTestId('content-column').props.style).maxWidth,
    ).toBeUndefined()
  })
})

describe('step transition', () => {
  it('rises over 360 ms at full motion (the moonrise preset)', () => {
    expect(stepTransition(false)).toEqual({ animation: 'fade_from_bottom', animationDuration: 360 })
  })

  it('only fades for 160 ms with Reduce Motion on', () => {
    expect(stepTransition(true)).toEqual({ animation: 'fade', animationDuration: 160 })
  })
})
