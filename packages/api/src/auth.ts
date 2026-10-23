import { AppError } from '@pawpin/core'
import { isAuthApiError, isAuthSessionMissingError } from '@supabase/supabase-js'
import { sessionStoreOf, type PawpinClient } from './client'
import { toAppError } from './errors'

/**
 * Emails a 6-digit sign-in code. Creates the account on first sign-in; the allowlist hook
 * refuses strangers, which rejects with INVITE_ONLY.
 */
export async function sendEmailCode(c: PawpinClient, email: string): Promise<void> {
  try {
    const { error } = await c.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    })
    if (error) throw error
  } catch (e) {
    throw toAppError(e)
  }
}

/** Signs in with the emailed code. A wrong or expired code rejects with UNAUTHENTICATED. */
export async function verifyEmailCode(c: PawpinClient, email: string, code: string): Promise<void> {
  try {
    const { data, error } = await c.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    })
    if (error) throw error
    if (data.session === null) throw new AppError('UNAUTHENTICATED', 'no session after verifying')
  } catch (e) {
    throw toAppError(e)
  }
}

/** Signs in with the identity token from Sign in with Apple and the raw nonce it was made with. */
export async function signInWithAppleIdToken(
  c: PawpinClient,
  idToken: string,
  nonce: string,
): Promise<void> {
  try {
    const { error } = await c.auth.signInWithIdToken({ provider: 'apple', token: idToken, nonce })
    if (error) throw error
  } catch (e) {
    throw toAppError(e)
  }
}

/**
 * Starts Sign in with Apple on the web. Supabase sends the browser to Apple and back to this
 * page's origin with a session (the client reads it from the URL, see `detectSessionInUrl`), so
 * this resolves just before the browser leaves and nothing after it runs on the old page. Native
 * iOS uses `signInWithAppleIdToken` instead. The origin must be one of the project's allowed
 * redirect URLs.
 */
export async function signInWithAppleWeb(c: PawpinClient): Promise<void> {
  try {
    const origin = (globalThis as { location?: { origin?: string } }).location?.origin
    const { error } = await c.auth.signInWithOAuth({
      provider: 'apple',
      options: origin === undefined ? {} : { redirectTo: `${origin}/` },
    })
    if (error) throw error
  } catch (e) {
    throw toAppError(e)
  }
}

/**
 * What Auth says about this device's session:
 * - `valid`: it refreshed, so the session works (for example the access token had expired, or the
 *   device clock is off);
 * - `rejected`: Auth refused the refresh token (session revoked, account deleted), or no session
 *   is left to refresh;
 * - `unknown`: Auth could not answer (offline, timeout, a 5xx, rate limited), so nothing is known.
 */
export type SessionCheck = 'valid' | 'rejected' | 'unknown'

/**
 * Asks Auth whether the session is still good by refreshing it. Call it after a request came back
 * UNAUTHENTICATED, and sign out only on `rejected`: an UNAUTHENTICATED read can also come from a
 * refresh that failed for a moment (supabase-js then sends the anon key) or from clock skew, and
 * signing out then would throw away a refresh token that still works. Never rejects.
 */
export async function checkSession(c: PawpinClient): Promise<SessionCheck> {
  try {
    const { data, error } = await c.auth.refreshSession()
    if (error === null) return data.session === null ? 'unknown' : 'valid'
    if (isAuthSessionMissingError(error)) return 'rejected'
    // A 4xx is Auth refusing the refresh token, except a timeout (408) or rate limit (429).
    // A 5xx or no response arrives as AuthRetryableFetchError, and a refresh discarded because
    // another one won is not a verdict either: both stay `unknown`.
    if (isAuthApiError(error) && error.status >= 400 && error.status < 500) {
      return error.status === 408 || error.status === 429 ? 'unknown' : 'rejected'
    }
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

/** The person a session stored on this device belongs to. */
export type StoredSession = { userId: string; email: string | null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Whose session this device keeps, read from where supabase-js stores it: no request, no refresh,
 * and no verdict on whether the session still works.
 *
 * Offline, supabase-js retries the refresh of an expired session for about 25 s and then reports
 * no session, yet keeps it stored: it deletes a stored session only when Auth refuses it. So a
 * session still stored here is one nobody has refused. The app uses this only to show what it
 * saved for that person; requests still go through supabase-js, which refreshes the session or is
 * refused. `null` when nothing usable is stored (or the client was not made by
 * `createPawpinClient`). Never rejects.
 */
export async function readStoredSession(c: PawpinClient): Promise<StoredSession | null> {
  const store = sessionStoreOf(c)
  if (store === undefined) return null
  try {
    const raw = await store.storage.getItem(store.key)
    if (raw === null) return null
    const session: unknown = JSON.parse(raw)
    // What supabase-js needs to load a session at all (its `_isValidSession`), and the user.
    if (!isRecord(session) || !isRecord(session.user)) return null
    if (!('access_token' in session && 'refresh_token' in session && 'expires_at' in session)) {
      return null
    }
    const { user } = session
    if (typeof user.id !== 'string' || user.id === '') return null
    return { userId: user.id, email: typeof user.email === 'string' ? user.email : null }
  } catch {
    // Storage that can't be read, or a value that isn't JSON: nothing usable is stored.
    return null
  }
}

const forgetListeners = new WeakMap<PawpinClient, Set<() => void>>()

/**
 * Calls `listener` when this package forgets the client's session itself (`forgetSession`, or a
 * `signOut` that needed it). supabase-js reports no auth event then, so whoever follows the auth
 * state treats this as a sign-out. Returns the way to stop.
 */
export function onSessionForgotten(c: PawpinClient, listener: () => void): () => void {
  const listeners = forgetListeners.get(c) ?? new Set<() => void>()
  forgetListeners.set(c, listeners)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Signs out on this device without asking Auth: deletes the stored session at once and tells the
 * `onSessionForgotten` listeners. For when Auth can't be reached: supabase-js would first retry
 * refreshing an expired session (about 25 s offline) and then keep it. The refresh token is not
 * revoked on the server, but it no longer exists on this device, and a refresh already under way
 * is discarded by supabase-js because the stored session changed under it. Rejects with an
 * AppError only when the storage can't be written.
 */
export async function forgetSession(c: PawpinClient): Promise<void> {
  const store = sessionStoreOf(c)
  try {
    await store?.storage.removeItem(store.key)
  } catch (e) {
    throw toAppError(e)
  }
  forgetListeners.get(c)?.forEach((listener) => listener())
}

/**
 * Signs out on this device: revokes this session with Auth and forgets it. Resolves once the
 * session is gone from the device, whether or not Auth could be told; rejects with an AppError
 * only when it can't be forgotten.
 *
 * supabase-js forgets the session itself, even when the revoke request fails, except when it
 * can't load it: an expired access token whose refresh fails (offline, Auth down) makes it return
 * that error and keep the session, which would reopen the next start and refresh into a full
 * session once Auth is back. Then `forgetSession` forgets it.
 */
export async function signOut(c: PawpinClient): Promise<void> {
  const failed = await c.auth.signOut({ scope: 'local' }).then(
    ({ error }) => error !== null,
    () => true,
  )
  if (failed) await forgetSession(c)
}

/** The `{"error":"PAWPIN:<CODE>"}` body the Edge Functions answer with, plus the status. */
async function functionFailure(error: Error, response: Response | undefined): Promise<unknown> {
  if (response === undefined) return error
  let message = error.message
  try {
    const body: unknown = await response.clone().json()
    if (typeof body === 'object' && body !== null && 'error' in body) {
      if (typeof body.error === 'string') message = body.error
    }
  } catch {
    // Not JSON: keep the generic message; the status still says what happened.
  }
  return { name: error.name, message, status: response.status }
}

/**
 * Deletes the signed-in user's account, photos included, then forgets the session. Without a
 * usable session (expired, or the account is already gone) it rejects with UNAUTHENTICATED.
 */
export async function deleteAccount(c: PawpinClient): Promise<void> {
  try {
    const { error, response } = await c.functions.invoke('delete-account', { method: 'POST' })
    if (error) throw await functionFailure(error, response)
  } catch (e) {
    throw toAppError(e)
  }
  // The account is gone; drop its session on this device. Nothing on the server depends on this
  // succeeding, so a failure here does not fail the deletion.
  await signOut(c).catch(() => undefined)
}
