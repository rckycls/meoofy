import { describe, expect, it } from 'vitest'
import { AppError, ERROR_CODES, parseAppError } from './errors'

describe('ERROR_CODES', () => {
  it('lists exactly the nine app error codes', () => {
    expect([...ERROR_CODES]).toEqual([
      'UNAUTHENTICATED',
      'NOT_OWNER',
      'VALIDATION',
      'PET_LIMIT_REACHED',
      'PHOTO_QUALITY',
      'RATE_LIMITED',
      'INVITE_ONLY',
      'NETWORK',
      'UNKNOWN',
    ])
  })
})

describe('AppError', () => {
  it('is an Error carrying a code', () => {
    const e = new AppError('NOT_OWNER')
    expect(e).toBeInstanceOf(Error)
    expect(e).toBeInstanceOf(AppError)
    expect(e.code).toBe('NOT_OWNER')
    expect(e.name).toBe('AppError')
  })

  it('is retryable only for NETWORK and RATE_LIMITED', () => {
    const retryable = ERROR_CODES.filter((code) => new AppError(code).retryable)
    expect(retryable).toEqual(['RATE_LIMITED', 'NETWORK'])
  })

  it('keeps an optional message and cause', () => {
    const cause = new Error('boom')
    const e = new AppError('UNKNOWN', 'something broke', { cause })
    expect(e.message).toBe('something broke')
    expect(e.cause).toBe(cause)
  })
})

describe('parseAppError', () => {
  it('maps server MEOOFY codes from Postgres errors', () => {
    expect(parseAppError({ message: 'MEOOFY:PET_LIMIT_REACHED', code: 'P0001' }).code).toBe(
      'PET_LIMIT_REACHED',
    )
    for (const code of [
      'UNAUTHENTICATED',
      'NOT_OWNER',
      'VALIDATION',
      'PET_LIMIT_REACHED',
      'PHOTO_QUALITY',
      'RATE_LIMITED',
    ] as const) {
      expect(parseAppError({ message: `MEOOFY:${code}`, code: 'P0001' }).code).toBe(code)
    }
  })

  it('finds the MEOOFY code inside a longer message', () => {
    expect(parseAppError(new Error('rpc failed: MEOOFY:NOT_OWNER (detail)')).code).toBe('NOT_OWNER')
  })

  it('maps an unrecognised MEOOFY code to UNKNOWN', () => {
    expect(parseAppError({ message: 'MEOOFY:SOMETHING_NEW' }).code).toBe('UNKNOWN')
    expect(parseAppError({ message: 'MEOOFY:lowercase' }).code).toBe('UNKNOWN')
  })

  it('maps network failures to a retryable NETWORK error', () => {
    expect(parseAppError(new TypeError('Network request failed')).code).toBe('NETWORK')
    expect(parseAppError(new TypeError('Failed to fetch')).code).toBe('NETWORK')
    expect(parseAppError(new TypeError('Failed to fetch')).retryable).toBe(true)
  })

  it('does not treat other TypeErrors or plain errors as network failures', () => {
    expect(
      parseAppError(new TypeError("Cannot read properties of undefined (reading 'x')")).code,
    ).toBe('UNKNOWN')
    expect(parseAppError(new Error('Network request failed')).code).toBe('UNKNOWN')
  })

  it('maps the auth-hook rejection to INVITE_ONLY', () => {
    expect(parseAppError({ message: 'This pilot is invite-only' }).code).toBe('INVITE_ONLY')
  })

  it('maps 401s and JWT errors to UNAUTHENTICATED', () => {
    expect(parseAppError({ status: 401, message: 'JWT expired' }).code).toBe('UNAUTHENTICATED')
    expect(parseAppError({ status: 401 }).code).toBe('UNAUTHENTICATED')
    expect(parseAppError({ message: 'JWT expired' }).code).toBe('UNAUTHENTICATED')
    expect(parseAppError({ message: 'invalid JWT: unable to parse' }).code).toBe('UNAUTHENTICATED')
  })

  it('maps anything else to a non-retryable UNKNOWN', () => {
    for (const value of ['weird', 42, null, undefined, {}, [], new Error('nope'), { message: 7 }]) {
      const e = parseAppError(value)
      expect(e.code).toBe('UNKNOWN')
      expect(e.retryable).toBe(false)
    }
  })

  it('sets retryable from the mapped code', () => {
    expect(parseAppError({ message: 'MEOOFY:RATE_LIMITED' }).retryable).toBe(true)
    expect(parseAppError({ message: 'MEOOFY:VALIDATION' }).retryable).toBe(false)
    expect(parseAppError({ status: 401, message: 'JWT expired' }).retryable).toBe(false)
  })

  it('returns an existing AppError unchanged', () => {
    const e = new AppError('PHOTO_QUALITY')
    expect(parseAppError(e)).toBe(e)
  })

  it('keeps the original error as the cause and its message', () => {
    const raw = { message: 'MEOOFY:NOT_OWNER', code: 'P0001' }
    const e = parseAppError(raw)
    expect(e).toBeInstanceOf(AppError)
    expect(e.cause).toBe(raw)
    expect(e.message).toBe('MEOOFY:NOT_OWNER')
  })
})
