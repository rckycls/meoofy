import { AppError, parseAppError } from '@pawpin/core'
import { describe, expect, it } from 'vitest'
import { normalizeSupabaseError, toAppError, withStatus } from './errors'
import { listPets } from './pets'
import { offline, respond, stubClient, type Fetch } from './testSupport'

const codeOf = (e: unknown) => parseAppError(normalizeSupabaseError(e)).code

describe('normalizeSupabaseError: network failures become a fetch TypeError', () => {
  const expectNetwork = (e: unknown) => {
    const normalized = normalizeSupabaseError(e)
    expect(normalized).toBeInstanceOf(TypeError)
    expect((normalized as TypeError).message).toBe('Network request failed')
    const parsed = parseAppError(normalized)
    expect(parsed.code).toBe('NETWORK')
    expect(parsed.retryable).toBe(true)
  }

  it('auth-js AuthRetryableFetchError (fetch failed)', async () => {
    const { error } = await stubClient(offline).auth.signInWithOtp({ email: 'a@pawpin.test' })
    expect(error?.name).toBe('AuthRetryableFetchError')
    expectNetwork(error)
  })

  it('auth-js AuthRetryableFetchError (5xx)', async () => {
    const { error } = await stubClient(respond(503, { msg: 'unavailable' })).auth.signInWithOtp({
      email: 'a@pawpin.test',
    })
    expect(error?.name).toBe('AuthRetryableFetchError')
    expectNetwork(error)
  })

  it('storage-js StorageUnknownError wrapping a fetch failure', async () => {
    const { error } = await stubClient(offline).storage.from('pet-photos').list('someone')
    expect(error?.name).toBe('StorageUnknownError')
    expectNetwork(error)
  })

  it('postgrest error objects whose message starts with "TypeError:"', async () => {
    const { error } = await stubClient(offline).from('my_profile').select('id')
    expect(error?.message).toMatch(/^TypeError:/)
    expectNetwork(error)
  })

  it('functions-js FunctionsFetchError', async () => {
    const { error } = await stubClient(offline).functions.invoke('delete-account')
    expect(error?.name).toBe('FunctionsFetchError')
    expectNetwork(error)
  })

  it('leaves a StorageUnknownError that is not a fetch failure alone', async () => {
    const boom = async () => {
      throw new Error('boom')
    }
    const { error } = await stubClient(boom).storage.from('pet-photos').list('someone')
    expect(error?.name).toBe('StorageUnknownError')
    expect(normalizeSupabaseError(error)).toBe(error)
    expect(codeOf(error)).toBe('UNKNOWN')
  })

  // postgrest-js's own retry is off (`db.retry: false`), so a read the gateway can't serve right
  // now reaches the app as an error with that status: it may pass on its own, like a fetch failure.
  it.each([503, 520])('a PostgREST read answered %i (JSON body)', async (status) => {
    const { error, status: carried } = await stubClient(
      respond(status, { message: 'upstream connect error', code: '', details: null, hint: null }),
    )
      .from('pets')
      .select('id')
    expect(carried).toBe(status)
    expectNetwork(withStatus(error!, carried))
  })

  it.each([503, 520])(
    'a PostgREST read answered %i with a page instead of JSON',
    async (status) => {
      const page: Fetch = async () =>
        new Response('<html>origin unavailable</html>', {
          status,
          headers: { 'content-type': 'text/html' },
        })
      const { error, status: carried } = await stubClient(page).from('pets').select('id')
      expectNetwork(withStatus(error!, carried))
    },
  )

  it('a read through the API answered 503 rejects with NETWORK, which the app retries', async () => {
    await expect(
      listPets(stubClient(respond(503, { message: 'unavailable' }))),
    ).rejects.toMatchObject({ name: 'AppError', code: 'NETWORK', retryable: true })
  })

  it('leaves other 5xx answers alone', () => {
    expect(codeOf({ message: 'boom', status: 500 })).toBe('UNKNOWN')
    expect(codeOf({ message: 'bad gateway', status: 502 })).toBe('UNKNOWN')
  })

  it('leaves a TypeError that is not a fetch failure alone', () => {
    const bug = new TypeError('x is not a function')
    expect(normalizeSupabaseError(bug)).toBe(bug)
    expect(codeOf(bug)).toBe('UNKNOWN')
  })
})

describe('normalizeSupabaseError: permission denied and 401 become UNAUTHENTICATED', () => {
  it('PostgREST/Postgres 42501 (anon reading an api view)', async () => {
    const { error } = await stubClient(
      respond(401, {
        code: '42501',
        message: 'permission denied for view my_profile',
        details: null,
        hint: null,
      }),
    )
      .from('my_profile')
      .select('id')
    expect(error?.code).toBe('42501')
    expect(codeOf(error)).toBe('UNAUTHENTICATED')
  })

  it('42501 without a status', () => {
    expect(
      codeOf({ code: '42501', message: 'permission denied for function update_profile' }),
    ).toBe('UNAUTHENTICATED')
  })

  it('a PostgREST 401 carried as status', () => {
    expect(
      codeOf({ code: 'PGRST301', message: 'No suitable key or wrong key type', status: 401 }),
    ).toBe('UNAUTHENTICATED')
  })

  it('an auth-js AuthApiError with status 401', async () => {
    const { error } = await stubClient(
      respond(401, {
        code: 401,
        error_code: 'no_authorization',
        msg: 'This endpoint requires a valid Bearer token',
      }),
    ).auth.getUser('not-a-token')
    expect(error?.status).toBe(401)
    expect(codeOf(error)).toBe('UNAUTHENTICATED')
  })

  it('a functions-js FunctionsHttpError for a 401 response', async () => {
    const { error } = await stubClient(respond(401, { error: 'nope' })).functions.invoke(
      'delete-account',
    )
    expect(error?.name).toBe('FunctionsHttpError')
    expect(codeOf(error)).toBe('UNAUTHENTICATED')
  })
})

describe('normalizeSupabaseError: other Auth answers', () => {
  it('an expired or wrong email code (otp_expired) is UNAUTHENTICATED', async () => {
    const { error } = await stubClient(
      respond(403, {
        code: 403,
        error_code: 'otp_expired',
        msg: 'Token has expired or is invalid',
      }),
    ).auth.verifyOtp({ email: 'a@pawpin.test', token: '000000', type: 'email' })
    expect(error?.code).toBe('otp_expired')
    expect(codeOf(error)).toBe('UNAUTHENTICATED')
  })

  it('a 429 is RATE_LIMITED', async () => {
    const { error } = await stubClient(
      respond(429, {
        code: 429,
        error_code: 'over_email_send_rate_limit',
        msg: 'email rate limit exceeded',
      }),
    ).auth.signInWithOtp({ email: 'a@pawpin.test' })
    expect(error?.status).toBe(429)
    const parsed = parseAppError(normalizeSupabaseError(error))
    expect(parsed.code).toBe('RATE_LIMITED')
    expect(parsed.retryable).toBe(true)
  })

  it('the allowlist hook refusal stays INVITE_ONLY', async () => {
    const { error } = await stubClient(
      respond(403, { code: 403, error_code: 'unknown', msg: 'This pilot is invite-only' }),
    ).auth.signInWithOtp({ email: 'stranger@pawpin.test' })
    expect(codeOf(error)).toBe('INVITE_ONLY')
  })
})

describe('normalizeSupabaseError: everything else passes through', () => {
  it('keeps a PAWPIN:<CODE> server error as is, whatever its status', () => {
    const validation = { code: 'P0001', message: 'PAWPIN:VALIDATION', status: 400 }
    expect(normalizeSupabaseError(validation)).toBe(validation)
    expect(codeOf(validation)).toBe('VALIDATION')
    expect(codeOf({ message: 'PAWPIN:NOT_OWNER', status: 401 })).toBe('NOT_OWNER')
  })

  it('returns unrecognised values unchanged', () => {
    const plain = new Error('boom')
    expect(normalizeSupabaseError(plain)).toBe(plain)
    expect(normalizeSupabaseError('text')).toBe('text')
    expect(normalizeSupabaseError(null)).toBe(null)
    expect(normalizeSupabaseError(undefined)).toBe(undefined)
  })

  it('returns an AppError unchanged', () => {
    const appError = new AppError('PET_LIMIT_REACHED')
    expect(normalizeSupabaseError(appError)).toBe(appError)
    expect(toAppError(appError)).toBe(appError)
  })
})
