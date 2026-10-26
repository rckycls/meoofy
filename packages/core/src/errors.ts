/**
 * The nine error codes the app understands. Server codes are raised by the
 * database as `MEOOFY:<CODE>`; `INVITE_ONLY`, `NETWORK` and `UNKNOWN` are
 * produced on the client.
 */
export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'NOT_OWNER',
  'VALIDATION',
  'PET_LIMIT_REACHED',
  'PHOTO_QUALITY',
  'RATE_LIMITED',
  'INVITE_ONLY',
  'NETWORK',
  'UNKNOWN',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['NETWORK', 'RATE_LIMITED'])

/** An error the app can reason about: a stable code plus whether retrying may help. */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly retryable: boolean

  constructor(code: ErrorCode, message?: string, options?: { cause?: unknown }) {
    super(message ?? code, options)
    this.name = 'AppError'
    this.code = code
    this.retryable = RETRYABLE.has(code)
  }
}

const SERVER_CODE = /MEOOFY:([A-Z_]+)/
const NETWORK_MESSAGE = /network request failed|failed to fetch|load failed|networkerror/i
const JWT_MESSAGE = /\bjwt\b/i

const isErrorCode = (value: string): value is ErrorCode =>
  (ERROR_CODES as readonly string[]).includes(value)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/**
 * Maps anything thrown or returned as an error (a Postgres/Supabase error object,
 * a fetch `TypeError`, an auth error, a string) to an `AppError`.
 * Never throws; anything unrecognised becomes `UNKNOWN`.
 */
export function parseAppError(e: unknown): AppError {
  if (e instanceof AppError) return e

  const message = isRecord(e) && typeof e.message === 'string' ? e.message : undefined
  const make = (code: ErrorCode) => new AppError(code, message, { cause: e })

  if (message !== undefined) {
    const server = SERVER_CODE.exec(message)
    if (server) {
      const code = server[1]
      return make(code !== undefined && isErrorCode(code) ? code : 'UNKNOWN')
    }
  }

  // Matched by name rather than `instanceof` so errors from another realm still count.
  if (
    isRecord(e) &&
    e.name === 'TypeError' &&
    message !== undefined &&
    NETWORK_MESSAGE.test(message)
  ) {
    return make('NETWORK')
  }

  if (isRecord(e) && (e.status === 401 || (message !== undefined && JWT_MESSAGE.test(message)))) {
    return make('UNAUTHENTICATED')
  }

  if (message !== undefined && message.includes('invite-only')) return make('INVITE_ONLY')

  return make('UNKNOWN')
}
