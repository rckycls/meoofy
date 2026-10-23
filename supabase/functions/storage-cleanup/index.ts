// storage-cleanup: called by the pg_cron job every 5 minutes (migration 20261023000008_cleanup.sql)
// with the service role key. Removes the files queued in registry.storage_deletions and queues
// abandoned uploads and orphans for the next run. The logic is in ../_shared/cleanup.ts; this file
// only wires it to Supabase with the service role.
import { cleanupHandler } from '../_shared/cleanup.ts'
import { env, PHOTO_BUCKET, serviceClient } from '../_shared/supabase.ts'

const admin = serviceClient()

Deno.serve(
  cleanupHandler({
    serviceKey: env('SUPABASE_SERVICE_ROLE_KEY'),

    async enqueueStale() {
      const { data, error } = await admin.rpc('enqueue_stale_photos')
      if (error) throw error
      return data as number
    },

    async claim(limit) {
      const { data, error } = await admin.rpc('claim_storage_deletions', { max: limit })
      if (error) throw error
      return data as { id: number; storage_path: string }[]
    },

    async remove(paths) {
      // Storage skips paths that are already gone, so only an error can leave a file behind.
      const { error } = await admin.storage.from(PHOTO_BUCKET).remove(paths)
      if (error) throw error
      return { failed: [] }
    },

    async complete(doneIds, failed) {
      const { error } = await admin.rpc('complete_storage_deletions', { done: doneIds, failed })
      if (error) throw error
    },
  }),
)
