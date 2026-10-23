import { AppError } from '@pawpin/core'
import { isAuthApiError, isAuthSessionMissingError } from '@supabase/supabase-js'
import type { PawpinClient } from './client'
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

/**
 * Signs out on this device: revokes this session and forgets it. The session is forgotten even
 * when this rejects (for example offline), so the caller can treat the user as signed out.
 */
export async function signOut(c: PawpinClient): Promise<void> {
  try {
    const { error } = await c.auth.signOut({ scope: 'local' })
    if (error) throw error
  } catch (e) {
    throw toAppError(e)
  }
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
  try {
    // The account is gone; drop its session on this device. Nothing on the server depends on
    // this succeeding, so a failure here does not fail the deletion.
    await c.auth.signOut({ scope: 'local' })
  } catch {
    // ignored, see above
  }
}
