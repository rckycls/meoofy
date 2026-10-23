import * as Sentry from '@sentry/react-native'

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
