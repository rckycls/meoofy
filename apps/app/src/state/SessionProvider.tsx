import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AppState, Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import {
  createMeoofyClient,
  onSessionForgotten,
  readStoredSession,
  type MeoofyClient,
  type SessionStorage,
  type StoredSession,
} from '@meoofy/api'

import { env } from '../env'
import { followConnection, useOnline } from '../offline/useOnline'

export type Session = {
  client: MeoofyClient
  signedIn: boolean
  userId: string | null
  /** The signed-in person's email, or `null` when signed out or the session carries none. */
  email: string | null
  /**
   * Whether supabase-js has handed over a session (an auth event carried one), so requests carry
   * it. This is not a check with Auth: a stored access token that hasn't expired is handed over
   * without any request, and the server still judges every request. False while the person is
   * signed in only by the session stored on this device that supabase-js couldn't load (an
   * expired access token it couldn't refresh: offline, or Auth out of reach); the app then shows
   * what it saved for them, and requests still go through supabase-js.
   */
  clientHasSession: boolean
}

const SessionContext = createContext<Session | null>(null)

/**
 * Where the session is kept: the Keychain (expo-secure-store) on iOS, and
 * Supabase's default (localStorage) on the web.
 */
export function sessionStorageFor(os: typeof Platform.OS): SessionStorage | undefined {
  if (os === 'web') return undefined
  return {
    getItem: (key) => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value),
    removeItem: (key) => SecureStore.deleteItemAsync(key),
  }
}

function createClient(): MeoofyClient {
  return createMeoofyClient({
    url: env.supabaseUrl,
    anonKey: env.supabaseAnonKey,
    storage: sessionStorageFor(Platform.OS),
    // Sign in with Apple on the web returns to the app with the session in the URL.
    detectSessionInUrl: Platform.OS === 'web',
  })
}

type User = { id: string; email: string | null; clientHasSession: boolean }
type AuthState = { ready: false } | { ready: true; user: User | null }

const storedOnly = (stored: StoredSession): User => ({
  id: stored.userId,
  email: stored.email,
  clientHasSession: false,
})

/**
 * Owns the app's one Supabase client and follows its auth state. Children
 * render once the stored session has been read, so nothing below ever sees a
 * "not known yet" session (the splash screen covers the wait). It also feeds
 * the device's connection to TanStack Query (`followConnection`).
 *
 * Signed in, offline: supabase-js reports INITIAL_SESSION only once it has
 * tried to refresh an expired session, which offline takes about 25 s of
 * retries, and then reports no session while keeping it stored. It deletes a
 * stored session only when Auth refuses it, so a session still stored is one
 * nobody has refused:
 * - offline with a stored session, the app opens at once for that person;
 * - INITIAL_SESSION without a session, with one still stored, keeps them in;
 * - Auth's later events decide: TOKEN_REFRESHED or SIGNED_IN for the same
 *   person hands supabase-js the session (their cache stays), another person
 *   replaces them, and SIGNED_OUT (a refused session included) signs them out;
 * - signing out while supabase-js can't load the session is done by
 *   `@meoofy/api` (`onSessionForgotten`), with no auth event.
 * Online, the app waits for supabase-js, which answers quickly there.
 *
 * `client` is for tests; the app lets the provider create its own.
 */
export function SessionProvider({
  children,
  client: injected,
}: {
  children: ReactNode
  client?: MeoofyClient
}) {
  const [client] = useState(() => injected ?? createClient())
  const [auth, setAuth] = useState<AuthState>({ ready: false })
  const [stored, setStored] = useState<StoredSession | null>(null)
  const online = useOnline()

  useEffect(() => followConnection(), [])

  useEffect(() => {
    let active = true
    // Counts events, so a storage read started for one is dropped once a newer one has arrived.
    let latest = 0
    // Fires INITIAL_SESSION once the stored session is loaded, then on every
    // sign-in, sign-out and refresh. Only state is set here: awaiting other
    // client calls inside this callback can deadlock supabase-js.
    const { data } = client.auth.onAuthStateChange((event, session) => {
      const seen = ++latest
      if (session !== null) {
        const user = { id: session.user.id, email: session.user.email ?? null }
        setAuth({ ready: true, user: { ...user, clientHasSession: true } })
      } else if (event === 'INITIAL_SESSION') {
        // No session to send, but one may still be stored that Auth couldn't be asked about.
        void readStoredSession(client).then((kept) => {
          if (active && seen === latest) {
            setAuth({ ready: true, user: kept === null ? null : storedOnly(kept) })
          }
        })
      } else {
        setAuth({ ready: true, user: null })
      }
    })
    // `@meoofy/api` forgot the session itself (signing out while supabase-js couldn't load it):
    // supabase-js reports nothing, so this is the sign-out.
    const stopForgotten = onSessionForgotten(client, () => {
      ++latest
      setAuth({ ready: true, user: null })
    })
    void readStoredSession(client).then((kept) => {
      if (active) setStored(kept)
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
      stopForgotten()
    }
  }, [client])

  useEffect(() => {
    // Offline, open now on the stored session instead of waiting out supabase-js's retries. Once
    // open, the app stays open until Auth says otherwise, even if the connection comes back first.
    if (stored === null || online) return
    setAuth((current) => (current.ready ? current : { ready: true, user: storedOnly(stored) }))
  }, [stored, online])

  useEffect(() => {
    // Timers do not run while an iOS app is in the background, so token
    // refresh follows the app state (as Supabase recommends for React Native).
    if (Platform.OS === 'web') return
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void client.auth.startAutoRefresh()
      else void client.auth.stopAutoRefresh()
    })
    return () => subscription.remove()
  }, [client])

  const user = auth.ready ? auth.user : null
  const userId = user?.id ?? null
  const email = user?.email ?? null
  const clientHasSession = user?.clientHasSession ?? false
  const value = useMemo<Session>(
    () => ({ client, signedIn: userId !== null, userId, email, clientHasSession }),
    [client, userId, email, clientHasSession],
  )

  if (!auth.ready) return null
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (session === null) throw new Error('useSession must be used inside <SessionProvider>')
  return session
}
