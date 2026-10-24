import { AppError, parseAppError } from '@pawpin/core'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const messageOf = (e: Record<string, unknown>): string | undefined =>
  typeof e.message === 'string' ? e.message : undefined

/** What every runtime's fetch rejects with when the server can't be reached: a TypeError. */
const FETCH_FAILURE = /fetch|network|load failed/i
const isFetchFailure = (e: unknown): boolean =>
  isRecord(e) && e.name === 'TypeError' && FETCH_FAILURE.test(messageOf(e) ?? '')

/** The HTTP status an error carries: its own, or that of the Response it wraps (functions-js). */
function statusOf(e: Record<string, unknown>): number | undefined {
  if (typeof e.status === 'number') return e.status
  if (isRecord(e.context) && typeof e.context.status === 'number') return e.context.status
  return undefined
}

const networkError = (cause: unknown) => new TypeError('Network request failed', { cause })

/**
 * Answers that mean the service could not be reached for a moment, not that the request was
 * wrong: 503 (the gateway or PostgREST is unavailable) and 520 (an edge proxy got no usable
 * answer from the origin). postgrest-js's own retry is off, so these reach the app.
 */
const UNAVAILABLE: ReadonlySet<number> = new Set([503, 520])

/**
 * Rewrites the error shapes supabase-js produces into ones `parseAppError` understands:
 * - Network failures become `TypeError('Network request failed')` (so NETWORK, retryable):
 *   auth-js `AuthRetryableFetchError` (no response, or a 5xx), storage-js `StorageUnknownError`
 *   wrapping a fetch failure, functions-js `FunctionsFetchError`, PostgREST error objects
 *   whose message starts with `TypeError:` (postgrest-js turns a failed fetch into one), and any
 *   answer with status 503 or 520 (the service is unavailable for a moment).
 * - Permission denied (`42501`, what anon gets from an `api` view or function) and any 401
 *   become UNAUTHENTICATED; so does an expired or wrong email code (`otp_expired`).
 * - A 429 (Auth's email, OTP and sign-in rate limits) becomes RATE_LIMITED.
 * A `PAWPIN:<CODE>` server error, an AppError and anything unrecognised pass through unchanged.
 */
export function normalizeSupabaseError(e: unknown): unknown {
  if (e instanceof AppError || !isRecord(e)) return e
  const message = messageOf(e)
  if (message?.includes('PAWPIN:')) return e

  if (
    e.name === 'AuthRetryableFetchError' ||
    (e.name === 'StorageUnknownError' && isFetchFailure(e.originalError)) ||
    (e.name === 'FunctionsFetchError' && isFetchFailure(e.context)) ||
    message?.startsWith('TypeError:')
  ) {
    return networkError(e)
  }

  const status = statusOf(e)
  if (status !== undefined && UNAVAILABLE.has(status)) return networkError(e)
  if (e.code === '42501' || status === 401 || e.code === 'otp_expired') {
    return new AppError('UNAUTHENTICATED', message, { cause: e })
  }
  if (status === 429) return new AppError('RATE_LIMITED', message, { cause: e })

  return e
}

/** The single exit for errors: everything an exported function throws goes through here. */
export function toAppError(e: unknown): AppError {
  return parseAppError(normalizeSupabaseError(e))
}

/**
 * A PostgREST result's error with the response status attached: postgrest-js reports the status
 * on the result, not on the error, and a 401 must still read as UNAUTHENTICATED.
 */
export function withStatus(error: object, status: number): Record<string, unknown> {
  return { ...error, status }
}
