import { checkSession, signOut, type MeoofyClient, type SessionCheck } from '@meoofy/api'

const inFlight = new WeakMap<MeoofyClient, Promise<SessionCheck>>()
const byFailure = new WeakMap<object, Promise<SessionCheck>>()

function startCheck(client: MeoofyClient): Promise<SessionCheck> {
  const check = (async () => {
    const outcome = await checkSession(client)
    // signOut forgets the session even when its request fails.
    if (outcome === 'rejected') await signOut(client).catch(() => undefined)
    return outcome
  })().finally(() => inFlight.delete(client))
  inFlight.set(client, check)
  return check
}

/**
 * Called after a read failed with UNAUTHENTICATED (`failure` is that error). The session may be
 * gone (revoked, or the account was deleted on another device), but a token refresh that failed
 * for a moment or an off device clock look the same. Asks Auth, and signs out on this device only
 * when Auth definitely refused the session; that sign-out has happened by the time this resolves.
 *
 * One failure gets one check, whoever asks (the query layer and the entry gate both do), and
 * failures that arrive together share the request.
 */
export function confirmSession(client: MeoofyClient, failure: unknown): Promise<SessionCheck> {
  const key = typeof failure === 'object' && failure !== null ? failure : null
  const known = key === null ? undefined : byFailure.get(key)
  if (known !== undefined) return known

  const check = inFlight.get(client) ?? startCheck(client)
  if (key !== null) byFailure.set(key, check)
  return check
}
