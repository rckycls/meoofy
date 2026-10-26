import { appError, bearerToken } from './http.ts'

/** Storage removes at most this many paths per call. */
export const REMOVE_CHUNK_SIZE = 1000

export interface DeleteAccountDeps {
  /** Every object path under `prefix` in the pet-photos bucket. */
  listPaths(prefix: string): Promise<string[]>
  /** Removes these objects (at most REMOVE_CHUNK_SIZE). Throws when Storage refuses. */
  removePaths(paths: string[]): Promise<void>
  /** Writes an identity-free audit event (actor and subject null, empty metadata). */
  recordAudit(action: string): Promise<void>
  /** Deletes the auth user; every row of theirs cascades. */
  deleteUser(uid: string): Promise<void>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Deletes an account: removes every file under `{uid}/` in chunks of REMOVE_CHUNK_SIZE, then
 * records `account.deleted`, then deletes the auth user. Each step runs only if the one before
 * succeeded, so a failed file removal leaves the user (and so the right to retry) in place.
 */
export async function deleteAccount(uid: string, deps: DeleteAccountDeps): Promise<void> {
  // The uid becomes a storage prefix: anything but a uuid could reach other users' files.
  if (!UUID.test(uid)) throw new Error('deleteAccount: uid must be a uuid')

  const prefix = `${uid}/`
  const paths = await deps.listPaths(prefix)
  if (paths.some((path) => !path.startsWith(prefix))) {
    throw new Error('deleteAccount: listed a path outside the user folder')
  }

  for (let i = 0; i < paths.length; i += REMOVE_CHUNK_SIZE) {
    await deps.removePaths(paths.slice(i, i + REMOVE_CHUNK_SIZE))
  }
  await deps.recordAudit('account.deleted')
  await deps.deleteUser(uid)
}

export interface DeleteAccountHandlerDeps extends DeleteAccountDeps {
  /** The user id a JWT belongs to, or null when it doesn't verify. Throws when it can't tell. */
  userIdFromJwt(jwt: string): Promise<string | null>
}

/** Lets the web app (react-native-web) call the function from the browser. */
export const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

/**
 * The delete-account Edge Function. POST with the caller's JWT deletes the caller's own account
 * and answers 204; without a JWT that verifies it answers 401 `{"error":"MEOOFY:UNAUTHENTICATED"}`.
 */
export function deleteAccountHandler(deps: DeleteAccountHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
    if (req.method !== 'POST') {
      return appError(405, 'VALIDATION', { ...corsHeaders, allow: 'POST, OPTIONS' })
    }

    const jwt = bearerToken(req)
    if (jwt === null) return appError(401, 'UNAUTHENTICATED', corsHeaders)

    try {
      const uid = await deps.userIdFromJwt(jwt)
      if (uid === null) return appError(401, 'UNAUTHENTICATED', corsHeaders)
      await deleteAccount(uid, deps)
      return new Response(null, { status: 204, headers: corsHeaders })
    } catch (error) {
      console.error('delete-account failed', error)
      return appError(500, 'UNKNOWN', corsHeaders)
    }
  }
}
