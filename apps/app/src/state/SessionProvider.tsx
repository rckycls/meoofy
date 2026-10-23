import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AppState, Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { createPawpinClient, type PawpinClient, type SessionStorage } from '@pawpin/api'

import { env } from '../env'

export type Session = {
  client: PawpinClient
  signedIn: boolean
  userId: string | null
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

function createClient(): PawpinClient {
  return createPawpinClient({
    url: env.supabaseUrl,
    anonKey: env.supabaseAnonKey,
    storage: sessionStorageFor(Platform.OS),
    // Sign in with Apple on the web returns to the app with the session in the URL.
    detectSessionInUrl: Platform.OS === 'web',
  })
}

type AuthState = { ready: false } | { ready: true; userId: string | null }

/**
 * Owns the app's one Supabase client and follows its auth state. Children
 * render once the stored session has been read, so nothing below ever sees a
 * "not known yet" session (the splash screen covers the wait).
 *
 * `client` is for tests; the app lets the provider create its own.
 */
export function SessionProvider({
  children,
  client: injected,
}: {
  children: ReactNode
  client?: PawpinClient
}) {
  const [client] = useState(() => injected ?? createClient())
  const [auth, setAuth] = useState<AuthState>({ ready: false })

  useEffect(() => {
    // Fires INITIAL_SESSION once the stored session is loaded, then on every
    // sign-in, sign-out and refresh. Only state is set here: awaiting other
    // client calls inside this callback can deadlock supabase-js.
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setAuth({ ready: true, userId: session?.user.id ?? null })
    })
    return () => data.subscription.unsubscribe()
  }, [client])

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

  const userId = auth.ready ? auth.userId : null
  const value = useMemo<Session>(
    () => ({ client, signedIn: userId !== null, userId }),
    [client, userId],
  )

  if (!auth.ready) return null
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (session === null) throw new Error('useSession must be used inside <SessionProvider>')
  return session
}
