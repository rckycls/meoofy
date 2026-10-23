import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { AccessibilityInfo, Platform, StyleSheet, Text, processColor } from 'react-native'
import { SafeAreaInsetsContext } from 'react-native-safe-area-context'

import * as ui from '../index'
import { cardRoles, flowTints } from '../theme/roles'
import { colors, radii, space } from '../theme/tokens'
import { Button } from './Button'
import { Card } from './Card'
import { Checkbox } from './Checkbox'
import { Chip } from './Chip'
import { Field } from './Field'
import { PrivacyBanner } from './PrivacyBanner'
import { ScreenShell } from './ScreenShell'
import { StepDots } from './StepDots'
import { Switch } from './Switch'
import { TabBar } from './TabBar'
import { WebNav } from './WebNav'

// Decorative layers (gradients, glows) are hidden from assistive tech, so the
// queries that look at them have to include hidden elements.
const hidden = { includeHiddenElements: true } as const

describe('Button', () => {
  it('does not call onPress when disabled and exposes the disabled state', async () => {
    const onPress = jest.fn()
    await render(<Button label="Continue" onPress={onPress} variant="primary" disabled />)

    const button = screen.getByRole('button', { name: 'Continue' })
    await fireEvent.press(button)

    expect(onPress).not.toHaveBeenCalled()
    expect(button.props.accessibilityState).toMatchObject({ disabled: true })
    expect(button).toBeDisabled()
  })

  it('calls onPress once when enabled', async () => {
    const onPress = jest.fn()
    await render(<Button label="Continue" onPress={onPress} variant="primary" />)

    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }))

    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('does not call onPress while loading and reports busy', async () => {
    const onPress = jest.fn()
    await render(<Button label="Saving" onPress={onPress} variant="primary" loading />)

    const button = screen.getByRole('button', { name: 'Saving' })
    await fireEvent.press(button)

    expect(onPress).not.toHaveBeenCalled()
    expect(button).toBeBusy()
    expect(button).toBeDisabled()
  })

  it('uses the deepBlue background for the urgent variant', async () => {
    await render(<Button label="I found a pet" onPress={jest.fn()} variant="urgent" />)

    const button = screen.getByRole('button', { name: 'I found a pet' })
    expect(button).toHaveStyle({ backgroundColor: colors.deepBlue })
    expect(screen.getByText('I found a pet')).toHaveStyle({ color: colors.white })
  })

  it('uses cobalt for primary and a white outlined surface for secondary', async () => {
    await render(
      <>
        <Button label="Primary" onPress={jest.fn()} variant="primary" />
        <Button label="Secondary" onPress={jest.fn()} variant="secondary" />
      </>,
    )

    expect(screen.getByRole('button', { name: 'Primary' })).toHaveStyle({
      backgroundColor: colors.cobalt,
    })
    expect(screen.getByRole('button', { name: 'Secondary' })).toHaveStyle({
      backgroundColor: colors.white,
      borderColor: colors.cobalt,
    })
    expect(screen.getByText('Secondary')).toHaveStyle({ color: colors.cobalt })
  })

  it('is at least 48 pt high with radius 16', async () => {
    await render(<Button label="Continue" onPress={jest.fn()} variant="primary" />)

    expect(screen.getByRole('button')).toHaveStyle({
      minHeight: 48,
      borderRadius: radii.button,
    })
    expect(radii.button).toBe(16)
  })

  it('greys out when disabled whatever the variant', async () => {
    await render(<Button label="Continue" onPress={jest.fn()} variant="urgent" disabled />)

    expect(screen.getByRole('button')).toHaveStyle({ backgroundColor: colors.mistGray })
    expect(screen.getByText('Continue')).toHaveStyle({ color: colors.slate })
  })
})

describe('Card', () => {
  it('renders the title in the role title colour', async () => {
    await render(
      <Card role="tip" title="Face, side and markings">
        Take three clear photos.
      </Card>,
    )

    expect(screen.getByText('Face, side and markings')).toHaveStyle({ color: '#1C7055' })
    expect(screen.getByRole('header', { name: 'Face, side and markings' })).toBeOnTheScreen()
  })

  it('paints a vertical gradient from the role start to the role end', async () => {
    await render(<Card role="warning">Body</Card>)

    const gradient = screen.getByTestId('card-gradient', hidden)
    expect(gradient.props.colors).toEqual([
      processColor(cardRoles.warning.from),
      processColor(cardRoles.warning.to),
    ])
    expect(gradient.props.startPoint).toEqual([0.5, 0])
    expect(gradient.props.endPoint).toEqual([0.5, 1])
  })

  it('sets plain string children in the role body colour', async () => {
    await render(<Card role="community">Neighbours can help.</Card>)

    expect(screen.getByText('Neighbours can help.')).toHaveStyle({
      color: cardRoles.community.body,
    })
  })

  it('draws the stroke for the plain role only', async () => {
    await render(
      <>
        <Card role="plain" title="Plain">
          Body
        </Card>
        <Card role="tip" title="Tip">
          Body
        </Card>
      </>,
    )

    const [plain, tip] = screen.getAllByTestId('card')
    expect(plain).toHaveStyle({ borderColor: '#E9EEF6', borderRadius: radii.card })
    expect(StyleSheet.flatten(tip?.props.style).borderColor).toBeUndefined()
  })
})

describe('Chip', () => {
  it('renders Missing with the softYellow background', async () => {
    await render(<Chip kind="missing" />)

    expect(screen.getByText('Missing')).toBeOnTheScreen()
    expect(screen.getByTestId('chip')).toHaveStyle({
      backgroundColor: colors.softYellow,
      borderRadius: radii.chip,
    })
  })

  it('renders Private and Recovered from their card roles', async () => {
    await render(
      <>
        <Chip kind="private" />
        <Chip kind="recovered" />
      </>,
    )

    const [privateChip, recoveredChip] = screen.getAllByTestId('chip')
    expect(screen.getByText('Private')).toHaveStyle({ color: cardRoles.privacy.title })
    expect(privateChip).toHaveStyle({ backgroundColor: cardRoles.privacy.from })
    expect(screen.getByText('Recovered')).toHaveStyle({ color: cardRoles.tip.title })
    expect(recoveredChip).toHaveStyle({ backgroundColor: cardRoles.tip.from })
  })
})

describe('Field', () => {
  it('exposes the error text as the accessibility hint and shows it', async () => {
    await render(<Field label="Pet name" value="" onChangeText={jest.fn()} error="Enter a name" />)

    expect(screen.getByHintText('Enter a name')).toBeOnTheScreen()
    expect(screen.getByText('Enter a name')).toBeOnTheScreen()
    expect(screen.getByLabelText('Pet name')).toHaveProp('accessibilityHint', 'Enter a name')
  })

  it('has no hint and no error text when valid', async () => {
    await render(<Field label="Pet name" value="Biscuit" onChangeText={jest.fn()} />)

    const input = screen.getByLabelText('Pet name')
    expect(input.props.accessibilityHint).toBeUndefined()
    expect(input).toHaveDisplayValue('Biscuit')
  })

  it('reports typed text and forwards TextInput props', async () => {
    const onChangeText = jest.fn()
    await render(
      <Field
        label="Pet name"
        value=""
        onChangeText={onChangeText}
        placeholder="Biscuit"
        autoCapitalize="words"
      />,
    )

    const input = screen.getByLabelText('Pet name')
    await fireEvent.changeText(input, 'Mochi')

    expect(onChangeText).toHaveBeenCalledWith('Mochi')
    expect(input).toHaveProp('autoCapitalize', 'words')
    expect(input).toHaveProp('placeholder', 'Biscuit')
  })

  it('is at least 44 pt tall with radius 12', async () => {
    await render(<Field label="Pet name" value="" onChangeText={jest.fn()} />)

    expect(screen.getByLabelText('Pet name')).toHaveStyle({
      minHeight: 48,
      borderRadius: radii.field,
    })
  })

  it('marks an invalid field with the warning colour', async () => {
    await render(<Field label="Pet name" value="" onChangeText={jest.fn()} error="Enter a name" />)

    expect(screen.getByLabelText('Pet name')).toHaveStyle({
      borderColor: cardRoles.warning.title,
    })
    expect(screen.getByText('Enter a name')).toHaveStyle({ color: cardRoles.warning.title })
  })
})

describe('Switch', () => {
  it('exposes the switch role, label and checked state', async () => {
    await render(<Switch value label="Share my pet's photo" onValueChange={jest.fn()} />)

    const control = screen.getByRole('switch', { name: "Share my pet's photo" })
    expect(control).toBeChecked()
  })

  it('asks for the opposite value when pressed', async () => {
    const onValueChange = jest.fn()
    await render(<Switch value={false} label="Alerts" onValueChange={onValueChange} />)

    const control = screen.getByRole('switch', { name: 'Alerts' })
    expect(control).not.toBeChecked()
    await fireEvent.press(control)

    expect(onValueChange).toHaveBeenCalledWith(true)
  })

  it('has a tap target of at least 44 pt', async () => {
    await render(<Switch value={false} label="Alerts" onValueChange={jest.fn()} />)

    expect(screen.getByRole('switch')).toHaveStyle({ minHeight: 48 })
  })
})

describe('Checkbox', () => {
  it('exposes the checkbox role, label and checked state', async () => {
    await render(<Checkbox checked label="I agree" onChange={jest.fn()} />)

    expect(screen.getByRole('checkbox', { name: 'I agree' })).toBeChecked()
  })

  it('asks for the opposite value when pressed', async () => {
    const onChange = jest.fn()
    await render(<Checkbox checked={false} label="I agree" onChange={onChange} />)

    const control = screen.getByRole('checkbox', { name: 'I agree' })
    expect(control).not.toBeChecked()
    await fireEvent.press(control)

    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('has a tap target of at least 44 pt', async () => {
    await render(<Checkbox checked={false} label="I agree" onChange={jest.fn()} />)

    expect(screen.getByRole('checkbox')).toHaveStyle({ minHeight: 48 })
  })
})

describe('PrivacyBanner', () => {
  it('shows its text on the privacy role', async () => {
    await render(<PrivacyBanner text="Only you can see these photos." />)

    expect(screen.getByText('Only you can see these photos.')).toHaveStyle({
      color: cardRoles.privacy.body,
    })
    const gradient = screen.getByTestId('card-gradient', hidden)
    expect(gradient.props.colors).toEqual([
      processColor(cardRoles.privacy.from),
      processColor(cardRoles.privacy.to),
    ])
  })
})

describe('StepDots', () => {
  it('renders one dot per step and widens the current one to 20', async () => {
    await render(<StepDots count={3} current={1} />)

    const dots = screen.getAllByTestId(/^step-dot-/)
    expect(dots).toHaveLength(3)
    expect(dots[0]).toHaveStyle({ width: 8, backgroundColor: colors.sky })
    expect(dots[1]).toHaveStyle({ width: 20, backgroundColor: colors.cobalt })
    expect(dots[2]).toHaveStyle({ width: 8 })
  })

  it('announces the position as progress', async () => {
    await render(<StepDots count={3} current={1} />)

    const progress = screen.getByRole('progressbar', { name: 'Step 2 of 3' })
    expect(progress).toHaveAccessibilityValue({ min: 1, max: 3, now: 2 })
  })
})

describe('ScreenShell', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  const insets = { top: 47, right: 0, bottom: 34, left: 0 }

  it('paints the flow tint gradient and the two glows', async () => {
    await render(
      <ScreenShell flow="recovery">
        <Button label="Go" onPress={jest.fn()} variant="primary" />
      </ScreenShell>,
    )

    expect(screen.getByRole('button', { name: 'Go' })).toBeOnTheScreen()
    const gradient = screen.getByTestId('screen-gradient', hidden)
    expect(gradient.props.colors).toEqual([
      processColor(flowTints.recovery.tint),
      processColor('#F7F5FF'),
      processColor(colors.cloud),
    ])
    expect(gradient.props.startPoint).toEqual([0.5, 0])
    expect(gradient.props.endPoint).toEqual([0.5, 1])

    const glowA = screen.getByTestId('glow-a', hidden)
    expect(glowA).toHaveStyle({ backgroundColor: flowTints.recovery.glowA })
    const a = StyleSheet.flatten(glowA.props.style)
    expect(a.top).toBeLessThan(0)
    expect(a.right).toBeLessThan(0)
    expect(a.bottom).toBeUndefined()
    expect(a.left).toBeUndefined()

    const glowB = screen.getByTestId('glow-b', hidden)
    expect(glowB).toHaveStyle({ backgroundColor: flowTints.recovery.glowB })
    const b = StyleSheet.flatten(glowB.props.style)
    expect(b.bottom).toBeLessThan(0)
    expect(b.left).toBeLessThan(0)
    expect(b.top).toBeUndefined()
    expect(b.right).toBeUndefined()
  })

  it('softens the glows with one blur layer on native', async () => {
    await render(<ScreenShell flow="owner" />)

    expect(screen.getByTestId('glow-blur', hidden)).toBeOnTheScreen()
    expect(
      StyleSheet.flatten(screen.getByTestId('glow-a', hidden).props.style).filter,
    ).toBeUndefined()
  })

  it('blurs each glow with a CSS filter on the web', async () => {
    jest.replaceProperty(Platform, 'OS', 'web')
    await render(<ScreenShell flow="owner" />)

    for (const id of ['glow-a', 'glow-b']) {
      const glow = StyleSheet.flatten(screen.getByTestId(id, hidden).props.style)
      expect(glow.filter).toMatch(/^blur\(\d+px\)$/)
    }
    expect(screen.queryByTestId('glow-blur', hidden)).not.toBeOnTheScreen()
  })

  it('keeps the background out of the way of touches and screen readers', async () => {
    await render(<ScreenShell flow="owner" />)

    for (const id of ['screen-gradient', 'glow-a', 'glow-b', 'glow-blur']) {
      const layer = screen.getByTestId(id, hidden)
      expect(StyleSheet.flatten(layer.props.style)).toMatchObject({ pointerEvents: 'none' })
    }
    // The glows are hidden from the accessibility tree.
    expect(screen.queryByTestId('glow-a')).not.toBeOnTheScreen()
    expect(screen.queryByTestId('glow-b')).not.toBeOnTheScreen()
  })

  it('drops the glows, not the gradient, when Reduce Transparency is on', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled').mockResolvedValueOnce(true)
    await render(<ScreenShell flow="owner" />)

    await waitFor(() => expect(screen.queryByTestId('glow-a', hidden)).not.toBeOnTheScreen())
    expect(screen.queryByTestId('glow-b', hidden)).not.toBeOnTheScreen()
    expect(screen.queryByTestId('glow-blur', hidden)).not.toBeOnTheScreen()
    expect(screen.getByTestId('screen-gradient', hidden)).toBeOnTheScreen()
  })

  it('follows Reduce Transparency when it changes', async () => {
    let notify: (reduced: boolean) => void = () => {}
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementationOnce((_event, handler) => {
      notify = handler as (reduced: boolean) => void
      return { remove: jest.fn() }
    })
    await render(<ScreenShell flow="owner" />)
    expect(screen.getByTestId('glow-a', hidden)).toBeOnTheScreen()

    await act(() => notify(true))

    expect(screen.queryByTestId('glow-a', hidden)).not.toBeOnTheScreen()
  })

  it('pads content by the safe-area insets plus the screen gutter', async () => {
    await render(
      <SafeAreaInsetsContext.Provider value={insets}>
        <ShellText />
      </SafeAreaInsetsContext.Provider>,
    )

    const style = StyleSheet.flatten(screen.getByTestId('screen-content').props.style)
    expect(style.paddingTop).toBe(47 + space[16])
    expect(style.paddingBottom).toBe(34 + space[16])
    expect(style.paddingLeft).toBe(space[24])
    expect(style.paddingRight).toBe(space[24])
  })

  it('leaves out the edges a tab bar already covers', async () => {
    await render(
      <SafeAreaInsetsContext.Provider value={insets}>
        <ScreenShell flow="owner" edges={['top']}>
          <Text>content</Text>
        </ScreenShell>
      </SafeAreaInsetsContext.Provider>,
    )

    const style = StyleSheet.flatten(screen.getByTestId('screen-content').props.style)
    expect(style.paddingTop).toBe(47 + space[16])
    expect(style.paddingBottom).toBe(space[16])
  })

  it('renders without a SafeAreaProvider', async () => {
    await render(<ShellText />)

    expect(screen.getByText('content')).toBeOnTheScreen()
  })

  it('scrolls when asked to and pads the scroll content', async () => {
    await render(
      <SafeAreaInsetsContext.Provider value={insets}>
        <ScreenShell flow="owner" scroll>
          <Text>content</Text>
        </ScreenShell>
      </SafeAreaInsetsContext.Provider>,
    )

    const content = StyleSheet.flatten(
      screen.getByTestId('screen-content').props.contentContainerStyle,
    )
    expect(content.paddingTop).toBe(47 + space[16])
    expect(content.paddingBottom).toBe(34 + space[16])
  })
})

function ShellText() {
  return (
    <ScreenShell flow="owner">
      <Text>content</Text>
    </ScreenShell>
  )
}

describe('TabBar', () => {
  it('lists Home, Find, Alerts and Account and marks the active tab', async () => {
    await render(<TabBar active="find" onSelect={jest.fn()} />)

    expect(screen.getByTestId('tab-bar')).toHaveProp('accessibilityRole', 'tablist')
    expect(screen.getAllByRole('tab').map((tab) => tab.props.accessibilityLabel)).toEqual([
      'Home',
      'Find',
      'Alerts',
      'Account',
    ])
    expect(screen.getByRole('tab', { name: 'Find' })).toBeSelected()
    expect(screen.getByRole('tab', { name: 'Home' })).not.toBeSelected()
  })

  it('reports the pressed tab', async () => {
    const onSelect = jest.fn()
    await render(<TabBar active="home" onSelect={onSelect} />)

    await fireEvent.press(screen.getByRole('tab', { name: 'Alerts' }))

    expect(onSelect).toHaveBeenCalledWith('alerts')
  })

  it('has tap targets of at least 44 pt and pads the home indicator', async () => {
    await render(
      <SafeAreaInsetsContext.Provider value={{ top: 0, right: 0, bottom: 34, left: 0 }}>
        <TabBar active="home" onSelect={jest.fn()} />
      </SafeAreaInsetsContext.Provider>,
    )

    expect(screen.getByRole('tab', { name: 'Home' })).toHaveStyle({ minHeight: 48 })
    expect(screen.getByTestId('tab-bar')).toHaveStyle({ paddingBottom: 34 })
  })
})

describe('WebNav', () => {
  it('lists the four destinations and marks the active one', async () => {
    await render(<WebNav active="alerts" onSelect={jest.fn()} />)

    expect(screen.getByTestId('web-nav')).toHaveProp('role', 'navigation')
    expect(screen.getAllByRole('link').map((link) => link.props.accessibilityLabel)).toEqual([
      'Home',
      'Find',
      'Alerts',
      'Account',
    ])
    expect(screen.getByRole('link', { name: 'Alerts' })).toBeSelected()
    expect(screen.getByRole('link', { name: 'Home' })).not.toBeSelected()
  })

  it('reports the pressed destination', async () => {
    const onSelect = jest.fn()
    await render(<WebNav active="home" onSelect={onSelect} />)

    await fireEvent.press(screen.getByRole('link', { name: 'Account' }))

    expect(onSelect).toHaveBeenCalledWith('account')
  })
})

describe('type tokens', () => {
  it('maps fontFamily, fontSize and lineHeight and never emits fontWeight', async () => {
    await render(
      <ScreenShell flow="owner">
        <Card role="plain" title="Title">
          Body
        </Card>
        <Button label="Button" onPress={jest.fn()} variant="primary" />
        <Chip kind="private" />
        <Chip kind="missing" />
        <Chip kind="recovered" />
        <Field label="Label" value="value" onChangeText={jest.fn()} error="Error" />
        <Switch value label="Switch" onValueChange={jest.fn()} />
        <Checkbox checked label="Checkbox" onChange={jest.fn()} />
        <PrivacyBanner text="Banner" />
        <TabBar active="home" onSelect={jest.fn()} />
        <WebNav active="home" onSelect={jest.fn()} />
      </ScreenShell>,
    )

    const texts = screen.getAllByText(/./, hidden)
    expect(texts.length).toBeGreaterThan(10)
    for (const text of texts) {
      const style = StyleSheet.flatten(text.props.style)
      expect(style).not.toHaveProperty('fontWeight')
      expect(style.fontFamily).toMatch(/^Inter_(400|500|600|700)$/)
      expect(style.fontSize).toEqual(expect.any(Number))
      expect(style.lineHeight).toEqual(expect.any(Number))
    }
    for (const input of screen.getAllByLabelText('Label', hidden)) {
      const style = StyleSheet.flatten(input.props.style)
      expect(style).not.toHaveProperty('fontWeight')
      expect(style.fontFamily).toMatch(/^Inter_/)
    }
  })

  it('builds text styles from the token explicitly', () => {
    expect(ui.textStyle(ui.type.headline)).toEqual({
      fontFamily: 'Inter_700',
      fontSize: 28,
      lineHeight: 39,
    })
  })
})

describe('package entry', () => {
  it('re-exports the primitives', () => {
    expect(ui.Button).toBe(Button)
    expect(ui.Card).toBe(Card)
    expect(ui.Checkbox).toBe(Checkbox)
    expect(ui.Chip).toBe(Chip)
    expect(ui.Field).toBe(Field)
    expect(ui.PrivacyBanner).toBe(PrivacyBanner)
    expect(ui.ScreenShell).toBe(ScreenShell)
    expect(ui.StepDots).toBe(StepDots)
    expect(ui.Switch).toBe(Switch)
    expect(ui.TabBar).toBe(TabBar)
    expect(ui.WebNav).toBe(WebNav)
  })
})
