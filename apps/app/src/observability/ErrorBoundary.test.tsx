import { StyleSheet, Text, processColor } from 'react-native'
import * as Sentry from '@sentry/react-native'
import { fireEvent, render, screen } from '@testing-library/react-native'
import { Slot } from 'expo-router'
import { renderRouter } from 'expo-router/testing-library'
import { flowTints } from '@meoofy/ui'

import { ErrorBoundary } from './ErrorBoundary'
import { errorCopy } from './copy'

// The error text is what a person must never see: it carries a name, an email and a file path.
const SECRET = 'duplicate key for Milo, owner alex@example.com, file:///Users/alex/meoofy/pet.jpg'

// Decorative layers (gradient, glows) are hidden from assistive tech.
const hidden = { includeHiddenElements: true } as const

beforeEach(() => {
  jest.mocked(Sentry.captureException).mockClear()
  jest.mocked(Sentry.getClient).mockReset()
})

describe('ErrorBoundary', () => {
  it('shows friendly copy and a Try again button, and none of the error text', async () => {
    await render(<ErrorBoundary error={new Error(SECRET)} retry={jest.fn()} />)

    expect(screen.getByRole('header', { name: errorCopy.title })).toBeOnTheScreen()
    expect(screen.getByText(errorCopy.body)).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: errorCopy.retry })).toBeOnTheScreen()
    // Nothing on screen or in any accessibility label may carry the error's words.
    const rendered = JSON.stringify(screen.toJSON())
    for (const word of ['duplicate', 'Milo', 'alex', 'example.com', 'file://', 'Error:']) {
      expect(rendered).not.toContain(word)
    }
  })

  it('calls retry when Try again is pressed', async () => {
    const retry = jest.fn().mockResolvedValue(undefined)
    await render(<ErrorBoundary error={new Error('boom')} retry={retry} />)

    await fireEvent.press(screen.getByRole('button', { name: errorCopy.retry }))

    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('reads out the message as plain, unanimated status text with a 44 pt or larger button', async () => {
    await render(<ErrorBoundary error={new Error('boom')} retry={jest.fn()} />)

    const status = screen.getByTestId('error-status')
    expect(status.props.role).toBe('alert')
    expect(status.props.accessibilityLiveRegion).toBe('polite')
    expect(screen.getByText(errorCopy.title)).toBeOnTheScreen()
    expect(screen.getByText(errorCopy.body)).toBeOnTheScreen()
    const button = StyleSheet.flatten(
      screen.getByRole('button', { name: errorCopy.retry }).props.style,
    )
    expect(button.minHeight).toBeGreaterThanOrEqual(44)
  })

  it('sits on the resilience flow background', async () => {
    await render(<ErrorBoundary error={new Error('boom')} retry={jest.fn()} />)

    const gradient = screen.getByTestId('screen-gradient', hidden)
    expect(gradient.props.colors[0]).toBe(processColor(flowTints.resilience.tint))
  })

  describe('reporting', () => {
    it('sends the error to Sentry once when Sentry was started', async () => {
      jest.mocked(Sentry.getClient).mockReturnValue({} as ReturnType<typeof Sentry.getClient>)
      const error = new Error('boom')

      const view = await render(<ErrorBoundary error={error} retry={jest.fn()} />)
      await view.rerender(<ErrorBoundary error={error} retry={jest.fn()} />)

      expect(Sentry.captureException).toHaveBeenCalledTimes(1)
      expect(Sentry.captureException).toHaveBeenCalledWith(error)
    })

    it('sends nothing when Sentry was not started', async () => {
      jest.mocked(Sentry.getClient).mockReturnValue(undefined)

      await render(<ErrorBoundary error={new Error('boom')} retry={jest.fn()} />)

      expect(Sentry.captureException).not.toHaveBeenCalled()
    })
  })

  describe('as a route error boundary', () => {
    /** Throws until the test lets it through. */
    let allowRoute = false
    function Route() {
      if (!allowRoute) throw new Error(SECRET)
      return <Text>Route is fine</Text>
    }

    /**
     * React reports an error that a boundary catches on the console, with the component stack.
     * That one report of the deliberate error is swallowed; anything else still shows.
     */
    function silenceCaughtError() {
      const report = console.error.bind(console)
      return jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        if (!args.map(String).join(' ').includes('duplicate key for Milo')) report(...args)
      })
    }

    it('replaces a route that throws, without its error text, and retry brings the route back', async () => {
      const spy = silenceCaughtError()
      jest.mocked(Sentry.getClient).mockReturnValue({} as ReturnType<typeof Sentry.getClient>)
      allowRoute = false
      try {
        await renderRouter(
          { _layout: { default: () => <Slot />, ErrorBoundary }, index: Route },
          { initialUrl: '/' },
        )

        expect(await screen.findByRole('header', { name: errorCopy.title })).toBeOnTheScreen()
        expect(JSON.stringify(screen.toJSON())).not.toContain('Milo')
        // The error itself goes to Sentry (its beforeSend scrubs it).
        expect(Sentry.captureException).toHaveBeenCalledWith(
          expect.objectContaining({ message: SECRET }),
        )

        allowRoute = true
        await fireEvent.press(screen.getByRole('button', { name: errorCopy.retry }))

        expect(await screen.findByText('Route is fine')).toBeOnTheScreen()
      } finally {
        spy.mockRestore()
      }
    })
  })
})
