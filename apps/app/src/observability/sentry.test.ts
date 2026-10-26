import * as Sentry from '@sentry/react-native'
import { AppError, type ErrorCode } from '@meoofy/core'

import { scrubBreadcrumb } from './scrub'
import { initSentry, reportError, reportHandledError, scrubEvent } from './sentry'

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
      request: { url: 'https://meoofy.test/pets', headers: { cookie: 'a=b' } },
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

describe('reportHandledError', () => {
  const NAME = 'Milo'
  const EMAIL = 'alex@example.com'

  /**
   * A refused write as packages/api passes it on: an UNKNOWN AppError whose message and Postgres
   * details name a pet and a person in ways no scrubber can recognise.
   */
  const refusedWrite = () =>
    new AppError('UNKNOWN', `new row for relation "pets" violates check constraint (${NAME})`, {
      cause: {
        code: '23514',
        message: `new row for relation "pets" violates check constraint (${NAME})`,
        details: `Failing row contains (a6000000, ${NAME}, dog, ${EMAIL}).`,
        hint: null,
        status: 400,
      },
    })

  /** Everything handed to the SDK, with each Error's own fields spelled out. */
  const everythingSent = () =>
    JSON.stringify(jest.mocked(Sentry.captureException).mock.calls, (_key, value: unknown) =>
      value instanceof Error
        ? { name: value.name, message: value.message, stack: value.stack, cause: value.cause }
        : value,
    )

  const sentError = () => jest.mocked(Sentry.captureException).mock.calls[0]![0] as Error

  beforeEach(() => {
    jest.mocked(Sentry.getClient).mockReturnValue({} as ReturnType<typeof Sentry.getClient>)
  })

  it('sends a new error made only of the code, the HTTP status, the Postgres code and the operation', () => {
    const error = refusedWrite()

    reportHandledError(error, 'createPet')

    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
    const [sent, context] = jest.mocked(Sentry.captureException).mock.calls[0]!
    expect(sent).not.toBe(error)
    expect(sent).toBeInstanceOf(Error)
    expect((sent as Error).name).toBe('HandledError')
    expect((sent as Error).message).toBe('UNKNOWN in createPet (HTTP 400, Postgres 23514)')
    expect((sent as Error).cause).toBeUndefined()
    expect(context).toEqual({
      tags: {
        'app.code': 'UNKNOWN',
        'app.operation': 'createPet',
        'http.status': '400',
        'pg.code': '23514',
      },
      fingerprint: ['handled-error', 'createPet', '400', '23514'],
    })
  })

  it('never passes the raw message or details, a name or an email to Sentry', () => {
    reportHandledError(refusedWrite(), 'createPet')

    const sent = everythingSent()
    expect(sent).not.toContain(NAME)
    expect(sent).not.toContain(EMAIL)
    expect(sent).not.toContain('Failing row')
    expect(sent).not.toContain('violates')
  })

  it('leaves out a status or code it does not have', () => {
    reportHandledError(
      new TypeError(`Cannot read properties of undefined (reading '${NAME}')`),
      'pets',
    )

    expect(sentError().message).toBe('UNKNOWN in pets')
    expect(everythingSent()).not.toContain(NAME)
    expect(jest.mocked(Sentry.captureException).mock.calls[0]![1]).toEqual({
      tags: { 'app.code': 'UNKNOWN', 'app.operation': 'pets' },
      fingerprint: ['handled-error', 'pets', '', ''],
    })
  })

  it('keeps an error code only when it is a Postgres or PostgREST code', () => {
    reportHandledError(
      new AppError('UNKNOWN', 'boom', { cause: { code: `${EMAIL}`, status: 500 } }),
      'profile',
    )

    expect(sentError().message).toBe('UNKNOWN in profile (HTTP 500)')
    expect(everythingSent()).not.toContain(EMAIL)
  })

  it('names the operation "unknown" when it is not a plain name', () => {
    reportHandledError(refusedWrite(), EMAIL)

    expect(sentError().message).toBe('UNKNOWN in unknown (HTTP 400, Postgres 23514)')
    expect(everythingSent()).not.toContain(EMAIL)
  })

  it.each<ErrorCode>([
    'UNAUTHENTICATED',
    'NOT_OWNER',
    'VALIDATION',
    'PET_LIMIT_REACHED',
    'PHOTO_QUALITY',
    'RATE_LIMITED',
    'INVITE_ONLY',
    'NETWORK',
  ])('sends nothing for an expected failure (%s)', (code) => {
    reportHandledError(new AppError(code), 'createPet')

    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it('sends nothing when Sentry was not started', () => {
    jest.mocked(Sentry.getClient).mockReturnValue(undefined)

    reportHandledError(refusedWrite(), 'createPet')

    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it('does not throw when the SDK fails', () => {
    jest.mocked(Sentry.captureException).mockImplementationOnce(() => {
      throw new Error('native module missing')
    })

    expect(() => reportHandledError(refusedWrite(), 'createPet')).not.toThrow()
  })
})
