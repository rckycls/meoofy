import type { MeoofyClient } from '@meoofy/api'

type FakeSession = { user: { id: string; email?: string } } | null
type AuthListener = (event: string, session: FakeSession) => void

/**
 * A stand-in for the Supabase client covering what the session layer uses:
 * auth events, local sign-out and the auto-refresh switches. Data calls are
 * mocked at the `@meoofy/api` function level in the tests that need them.
 *
 * `initialSession: 'held'` keeps INITIAL_SESSION back until `releaseInitialSession()`, the way
 * supabase-js holds it while it retries the refresh of an expired session (about 25 s offline).
 *
 * `signOutFails: true` answers `signOut` the way supabase-js does when it can't load the session
 * (an expired access token whose refresh fails): an error, no event, and the session kept.
 */
export function fakeClient({
  userId = null,
  email,
  initialSession = 'now',
  signOutFails = false,
}: {
  userId?: string | null
  email?: string
  initialSession?: 'now' | 'held'
  signOutFails?: boolean
} = {}) {
  let session: FakeSession = userId === null ? null : { user: { id: userId, email } }
  const listeners = new Set<AuthListener>()
  const waiting = new Set<AuthListener>()
  const emit = (event: string) => listeners.forEach((listener) => listener(event, session))

  const auth = {
    onAuthStateChange: jest.fn((listener: AuthListener) => {
      listeners.add(listener)
      // Like supabase-js: the stored session arrives a tick later as INITIAL_SESSION.
      if (initialSession === 'now') {
        void Promise.resolve().then(() => listener('INITIAL_SESSION', session))
      } else {
        waiting.add(listener)
      }
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              listeners.delete(listener)
              waiting.delete(listener)
            },
          },
        },
      }
    }),
    signOut: jest.fn(async () => {
      if (signOutFails) return { error: { name: 'AuthRetryableFetchError', status: 0 } }
      session = null
      emit('SIGNED_OUT')
      return { error: null }
    }),
    startAutoRefresh: jest.fn(async () => undefined),
    stopAutoRefresh: jest.fn(async () => undefined),
  }

  return {
    client: { auth } as unknown as MeoofyClient,
    auth,
    /** Simulates a sign-in finishing (for example from the email-code screen). */
    signIn(id: string, signInEmail?: string) {
      session = { user: { id, email: signInEmail } }
      emit('SIGNED_IN')
    },
    /** Sends the held INITIAL_SESSION (with no session when the refresh could not be made). */
    releaseInitialSession() {
      waiting.forEach((listener) => listener('INITIAL_SESSION', session))
      waiting.clear()
    },
    /** Simulates supabase-js refreshing the session for `id` once Auth can be reached. */
    refresh(id: string, refreshedEmail?: string) {
      session = { user: { id, email: refreshedEmail } }
      emit('TOKEN_REFRESHED')
    },
    /** Simulates Auth refusing the refresh token: supabase-js deletes the session, SIGNED_OUT. */
    refuse() {
      session = null
      emit('SIGNED_OUT')
    },
  }
}
