const DSN = 'https://publickey@o123.ingest.sentry.io/456'

/**
 * Loads `app/_layout.tsx` fresh with the given EXPO_PUBLIC_SENTRY_DSN, as the bundle does at
 * start-up. Everything comes from the same fresh module graph, so the SDK stand-in is the one the
 * layout talked to. (`require`, because `import()` needs Node's experimental VM modules in Jest.)
 */
function loadRootLayout(dsn: string | undefined) {
  const previous = process.env.EXPO_PUBLIC_SENTRY_DSN
  if (dsn === undefined) delete process.env.EXPO_PUBLIC_SENTRY_DSN
  else process.env.EXPO_PUBLIC_SENTRY_DSN = dsn

  try {
    let loaded!: {
      sentry: typeof import('@sentry/react-native')
      layout: typeof import('../../app/_layout')
      boundary: typeof import('./ErrorBoundary')
      scrubbers: typeof import('./scrub')
    }
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports */
      loaded = {
        sentry: require('@sentry/react-native'),
        layout: require('../../app/_layout'),
        boundary: require('./ErrorBoundary'),
        scrubbers: require('./scrub'),
      }
      /* eslint-enable @typescript-eslint/no-require-imports */
    })
    return loaded
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_SENTRY_DSN
    else process.env.EXPO_PUBLIC_SENTRY_DSN = previous
  }
}

describe('root layout', () => {
  it('does not start Sentry when there is no DSN', () => {
    const { sentry } = loadRootLayout(undefined)

    expect(sentry.init).not.toHaveBeenCalled()
  })

  it('does not start Sentry when the DSN is blank', () => {
    const { sentry } = loadRootLayout('  ')

    expect(sentry.init).not.toHaveBeenCalled()
  })

  it('starts Sentry once, with the scrubbers, when a DSN is set', () => {
    const { sentry, scrubbers } = loadRootLayout(DSN)

    expect(sentry.init).toHaveBeenCalledTimes(1)
    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: DSN,
        sendDefaultPii: false,
        beforeSend: scrubbers.scrubEvent,
        beforeBreadcrumb: scrubbers.scrubBreadcrumb,
      }),
    )
  })

  it('uses the PawPin error screen as its route error boundary', () => {
    const { layout, boundary } = loadRootLayout(undefined)

    expect(layout.ErrorBoundary).toBe(boundary.ErrorBoundary)
  })
})
