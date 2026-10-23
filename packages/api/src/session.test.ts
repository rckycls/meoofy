// checkSession tells a dead session from a temporary failure after a request came back
// UNAUTHENTICATED, so the app signs out only when Auth has really refused the session.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkSession, type PawpinClient } from './index'
import { offline, refreshed, respond, signedInStubClient, stubClient } from './testSupport'

const ONE_HOUR = 3600

afterEach(() => {
  vi.useRealTimers()
})

/**
 * supabase-js retries a refresh that gets no answer (or a 5xx) with backoff for up to 30 s;
 * fake timers run those retries without the wait.
 */
async function checkWithRetries(client: PawpinClient) {
  vi.useFakeTimers()
  const outcome = checkSession(client)
  await vi.runAllTimersAsync()
  return outcome
}

describe('checkSession', () => {
  it('is valid when the session refreshes (expired access token, or a device clock that is off)', async () => {
    const fetch = vi.fn(refreshed)
    const { client } = signedInStubClient(fetch, { expiresIn: ONE_HOUR })

    expect(await checkSession(client)).toBe('valid')
    expect(String(fetch.mock.calls[0]?.[0])).toContain('/auth/v1/token?grant_type=refresh_token')
  })

  it('is unknown, and keeps the session, when Auth cannot be reached', async () => {
    const { client, stored } = signedInStubClient(offline, { expiresIn: -ONE_HOUR })

    expect(await checkWithRetries(client)).toBe('unknown')
    expect(stored()).not.toBeNull()
  })

  it('is unknown, and keeps the session, when Auth answers with a 5xx', async () => {
    const { client, stored } = signedInStubClient(respond(503, { msg: 'unavailable' }), {
      expiresIn: -ONE_HOUR,
    })

    expect(await checkWithRetries(client)).toBe('unknown')
    expect(stored()).not.toBeNull()
  })

  it('is unknown when Auth rate-limits the refresh', async () => {
    const { client } = signedInStubClient(
      respond(429, { error_code: 'over_request_rate_limit', msg: 'slow down' }),
      { expiresIn: ONE_HOUR },
    )

    expect(await checkSession(client)).toBe('unknown')
  })

  it('is rejected when Auth refuses the refresh token (revoked session, deleted account)', async () => {
    const { client } = signedInStubClient(
      respond(400, {
        code: 400,
        error_code: 'refresh_token_not_found',
        msg: 'Invalid Refresh Token: Refresh Token Not Found',
      }),
      { expiresIn: ONE_HOUR },
    )

    expect(await checkSession(client)).toBe('rejected')
  })

  it('is rejected when there is no session left', async () => {
    const fetch = vi.fn(refreshed)
    expect(await checkSession(stubClient(fetch))).toBe('rejected')
    expect(fetch).not.toHaveBeenCalled()
  })
})
