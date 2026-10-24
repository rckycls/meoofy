import * as Sentry from '@sentry/react-native'
import { parseAppError } from '@pawpin/core'

import { scrubBreadcrumb, scrubEvent } from './scrub'

export { scrubBreadcrumb, scrubEvent }

/**
 * Starts crash and error reporting. Call it once, at start-up, and only when a DSN is configured.
 *
 * Screens show names and photos, so everything that captures a screen or who is using it is off
 * on purpose. There is no session replay, no tracing and no `Sentry.wrap` (its touch boundary
 * records the label of whatever was pressed), and nobody is ever set as the user. What is left,
 * errors and breadcrumbs, passes through `scrubEvent` and `scrubBreadcrumb`.
 */
export function initSentry(dsn: string): void {
  try {
    Sentry.init({
      dsn,
      sendDefaultPii: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      reportAccessibilityIdentifier: false,
      enableUserInteractionTracing: false,
      enableCaptureFailedRequests: false,
      // The iOS layer's own network breadcrumbs repeat the JS ones (which are scrubbed) and would
      // reach a native crash report unscrubbed.
      enableNetworkBreadcrumbs: false,
      beforeSend: scrubEvent,
      beforeBreadcrumb: scrubBreadcrumb,
    })
  } catch (error) {
    // Error reporting must never be the reason the app does not open.
    console.warn('Error reporting did not start.', error)
  }
}

/** Sends a handled error to Sentry, if Sentry was started. It does not throw. */
export function reportError(error: unknown): void {
  try {
    if (Sentry.getClient()) Sentry.captureException(error)
  } catch {
    // Best effort: the person is already looking at the error screen.
  }
}

/** An operation name: a query key's root or a mutation key, never anything a person typed. */
const OPERATION = /^[A-Za-z][A-Za-z0-9]{0,39}$/
/** A Postgres SQLSTATE (five characters, such as 23514) or a PostgREST code (such as PGRST116). */
const POSTGRES_CODE = /^(?:[0-9A-Z]{5}|PGRST\d{3})$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/** The HTTP status a failure carried: its own, or that of the response it wraps (functions-js). */
function httpStatusOf(cause: unknown): number | undefined {
  if (!isRecord(cause)) return undefined
  const wrapped = isRecord(cause.context) ? cause.context.status : undefined
  const status = typeof cause.status === 'number' ? cause.status : wrapped
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : undefined
}

/** The failure's Postgres or PostgREST error code, if it has one. */
function postgresCodeOf(cause: unknown): string | undefined {
  return isRecord(cause) && typeof cause.code === 'string' && POSTGRES_CODE.test(cause.code)
    ? cause.code
    : undefined
}

/**
 * Sends an error the app has handled (with friendly copy) to Sentry when it was unexpected: when
 * it reads as UNKNOWN (spec §9). Errors the app expects, such as NETWORK or VALIDATION, are not
 * sent. `operation` names what failed: a query key's root (`pets`) or a mutation key
 * (`createPet`).
 *
 * What is sent is a new error built only from fields that can't hold personal data: the AppError
 * code, the HTTP status, the Postgres error code and the operation. The error itself never
 * leaves the device: its message and details can quote a row ("Failing row contains (…, Milo,
 * …)"), and a pet's or person's name is something no scrubber can recognise. The new error has no
 * `cause`, so the SDK has nothing to link back to the original. Does nothing when Sentry was not
 * started, and never throws.
 */
export function reportHandledError(error: unknown, operation: string): void {
  try {
    if (!Sentry.getClient()) return
    const { code, cause } = parseAppError(error)
    if (code !== 'UNKNOWN') return

    const name = OPERATION.test(operation) ? operation : 'unknown'
    const status = httpStatusOf(cause)
    const postgresCode = postgresCodeOf(cause)
    const facts = [
      status === undefined ? null : `HTTP ${status}`,
      postgresCode === undefined ? null : `Postgres ${postgresCode}`,
    ].filter((fact) => fact !== null)

    const handled = new Error(
      `${code} in ${name}${facts.length > 0 ? ` (${facts.join(', ')})` : ''}`,
    )
    handled.name = 'HandledError'
    Sentry.captureException(handled, {
      tags: {
        'app.code': code,
        'app.operation': name,
        ...(status === undefined ? {} : { 'http.status': String(status) }),
        ...(postgresCode === undefined ? {} : { 'pg.code': postgresCode }),
      },
      // One issue per operation and failure, not one for every report from this function.
      fingerprint: [
        'handled-error',
        name,
        status === undefined ? '' : String(status),
        postgresCode ?? '',
      ],
    })
  } catch {
    // Best effort: the person already has the friendly message.
  }
}
