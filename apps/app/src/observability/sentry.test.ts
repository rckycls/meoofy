import * as Sentry from '@sentry/react-native'

import { scrubBreadcrumb } from './scrub'
import { initSentry, reportError, scrubEvent } from './sentry'

const DSN = 'https://publickey@o123.ingest.sentry.io/456'

beforeEach(() => {
  jest.mocked(Sentry.init).mockClear()
  jest.mocked(Sentry.captureException).mockClear()
  jest.mocked(Sentry.setUser).mockClear()
  jest.mocked(Sentry.getClient).mockReset()
})

describe('scrubEvent', () => {
  it('keeps only the id of the user and replaces emails with [email]', () => {
    expect(
      scrubEvent({ user: { id: 'u1', email: 'a@b.co' }, message: 'failed for a@b.co' }),
    ).toEqual({ user: { id: 'u1' }, message: 'failed for [email]' })
  })

  it('replaces a storage path inside an exception value with [path]', () => {
    const owner = '3f2b8c1e-5a7d-4e0b-9c64-1d2e3f4a5b6c'
    const pet = '7a9d0e21-8b3c-4f5a-a1b2-c3d4e5f60718'
    const photo = '0c1d2e3f-4a5b-4c6d-8e7f-90a1b2c3d4e5'

    const scrubbed = scrubEvent({
      exception: { values: [{ value: `upload failed for ${owner}/${pet}/${photo}.jpg` }] },
    })

    expect(scrubbed.exception?.values?.[0]?.value).toBe('upload failed for [path]')
  })

  it('removes the request', () => {
    const scrubbed = scrubEvent({
      request: { url: 'https://pawpin.test/pets', headers: { cookie: 'a=b' } },
      message: 'boom',
    })

    expect(scrubbed).toEqual({ message: 'boom' })
    expect('request' in scrubbed).toBe(false)
  })
})

describe('initSentry', () => {
  function initOptions() {
    expect(Sentry.init).toHaveBeenCalledTimes(1)
    return jest.mocked(Sentry.init).mock.calls[0][0]
  }

  it('starts the SDK with the DSN, the scrubbers, and nothing that captures what is on screen', () => {
    initSentry(DSN)

    expect(initOptions()).toMatchObject({
      dsn: DSN,
      sendDefaultPii: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      reportAccessibilityIdentifier: false,
      enableUserInteractionTracing: false,
      enableCaptureFailedRequests: false,
      enableNetworkBreadcrumbs: false,
      beforeSend: scrubEvent,
      beforeBreadcrumb: scrubBreadcrumb,
    })
  })

  it('adds no session replay, no tracing and no extra integrations', () => {
    initSentry(DSN)

    const options = initOptions()
    expect(Object.keys(options).filter((key) => /replay/i.test(key))).toEqual([])
    expect(options.integrations).toBeUndefined()
    expect(options.tracesSampleRate).toBeUndefined()
    expect(options.tracesSampler).toBeUndefined()
    expect(options.enableLogs).toBeUndefined()
  })

  it('never sets a user', () => {
    initSentry(DSN)

    expect(Sentry.setUser).not.toHaveBeenCalled()
  })

  it('does not stop the app from opening when the SDK fails to start', () => {
    jest.mocked(Sentry.init).mockImplementationOnce(() => {
      throw new Error('native module missing')
    })
    // initSentry reports its own failure on the console; that one warning is checked, not shown.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      expect(() => initSentry(DSN)).not.toThrow()
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })
})

describe('reportError', () => {
  const error = new Error('boom')

  it('sends the error when Sentry was started', () => {
    jest.mocked(Sentry.getClient).mockReturnValue({} as ReturnType<typeof Sentry.getClient>)

    reportError(error)

    expect(Sentry.captureException).toHaveBeenCalledWith(error)
  })

  it('sends nothing when Sentry was not started', () => {
    jest.mocked(Sentry.getClient).mockReturnValue(undefined)

    reportError(error)

    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it('does not throw when the SDK fails, so the error screen still shows', () => {
    jest.mocked(Sentry.getClient).mockReturnValue({} as ReturnType<typeof Sentry.getClient>)
    jest.mocked(Sentry.captureException).mockImplementationOnce(() => {
      throw new Error('native module missing')
    })

    expect(() => reportError(error)).not.toThrow()
  })
})
