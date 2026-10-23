import type { PawpinClient } from '@pawpin/api'

type FakeSession = { user: { id: string } } | null
type AuthListener = (event: string, session: FakeSession) => void

/**
 * A stand-in for the Supabase client covering what the session layer uses:
 * auth events, local sign-out and the auto-refresh switches. Data calls are
 * mocked at the `@pawpin/api` function level in the tests that need them.
 */
export function fakeClient({ userId = null }: { userId?: string | null } = {}) {
  let session: FakeSession = userId === null ? null : { user: { id: userId } }
  const listeners = new Set<AuthListener>()
  const emit = (event: string) => listeners.forEach((listener) => listener(event, session))

  const auth = {
    onAuthStateChange: jest.fn((listener: AuthListener) => {
      listeners.add(listener)
      // Like supabase-js: the stored session arrives a tick later as INITIAL_SESSION.
      void Promise.resolve().then(() => listener('INITIAL_SESSION', session))
      return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } }
    }),
    signOut: jest.fn(async () => {
      session = null
      emit('SIGNED_OUT')
      return { error: null }
    }),
    startAutoRefresh: jest.fn(async () => undefined),
    stopAutoRefresh: jest.fn(async () => undefined),
  }

  return {
    client: { auth } as unknown as PawpinClient,
    auth,
    /** Simulates a sign-in finishing (for example from the email-code screen). */
    signIn(id: string) {
      session = { user: { id } }
      emit('SIGNED_IN')
    },
  }
}
