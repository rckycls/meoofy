// delete-account: POST with the caller's JWT deletes the caller's account (204), or answers 401
// {"error":"MEOOFY:UNAUTHENTICATED"}. The logic is in ../_shared/deleteAccount.ts; this file only
// wires it to Supabase with the service role.
import { deleteAccountHandler } from '../_shared/deleteAccount.ts'
import { listAllPaths } from '../_shared/storage.ts'
import { PHOTO_BUCKET, serviceClient } from '../_shared/supabase.ts'

const admin = serviceClient()
const photos = admin.storage.from(PHOTO_BUCKET)

/** The api wrapper that records each audit action this function writes. */
const AUDIT_RPC: Record<string, string> = { 'account.deleted': 'record_account_deleted' }

Deno.serve(
  deleteAccountHandler({
    async userIdFromJwt(jwt) {
      const { data, error } = await admin.auth.getUser(jwt)
      if (error) {
        // A 4xx means the token is bad or expired, or its user is gone. Anything else (Auth down,
        // a network failure) means Auth couldn't tell, which is not the caller's fault.
        if (error.status !== undefined && error.status >= 400 && error.status < 500) return null
        throw error
      }
      return data.user?.id ?? null
    },

    listPaths: (prefix) =>
      listAllPaths(async (folder, offset, limit) => {
        const { data, error } = await photos.list(folder, {
          limit,
          offset,
          sortBy: { column: 'name', order: 'asc' },
        })
        if (error) throw error
        return data.map((entry) => ({ name: entry.name, id: entry.id ?? null }))
      }, prefix),

    async removePaths(paths) {
      const { error } = await photos.remove(paths)
      if (error) throw error
    },

    async recordAudit(action) {
      const rpc = AUDIT_RPC[action]
      if (rpc === undefined) throw new Error(`delete-account: no audit function for ${action}`)
      const { error } = await admin.rpc(rpc)
      if (error) throw error
    },

    async deleteUser(uid) {
      const { error } = await admin.auth.admin.deleteUser(uid)
      if (error) throw error
    },
  }),
)
