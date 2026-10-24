import * as Sentry from '@sentry/react-native'

/**
 * Turns the Sentry stand-in from jest.setup.js on, as if a DSN were configured, and returns a
 * function that lists the messages of the errors sent to it from then on. Call
 * `turnSentryOff` after each test that uses it.
 */
export function sentryReports(): () => string[] {
  jest.mocked(Sentry.captureException).mockClear()
  jest.mocked(Sentry.getClient).mockReturnValue({} as ReturnType<typeof Sentry.getClient>)
  return () =>
    jest.mocked(Sentry.captureException).mock.calls.map(([error]) => (error as Error).message)
}

/** Back to no Sentry client (the default in tests), with no calls recorded. */
export function turnSentryOff(): void {
  jest.mocked(Sentry.getClient).mockReset()
  jest.mocked(Sentry.captureException).mockClear()
}
