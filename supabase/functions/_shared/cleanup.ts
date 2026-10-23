import { appError, bearerToken, json, sameSecret } from './http.ts'

/** Rows claimed per run. Storage removes at most 1000 paths per call, so one call per run. */
export const CLAIM_LIMIT = 1000

export interface CleanupDeps {
  /** Queues abandoned pending uploads and orphan files; returns how many paths it queued. */
  enqueueStale(): Promise<number>
  /** Claims up to `limit` queued rows (never a path a photo row still references). */
  claim(limit: number): Promise<{ id: number; storage_path: string }[]>
  /** Removes these objects; `failed` lists the paths that could not be removed. */
  remove(paths: string[]): Promise<{ failed: string[] }>
  /** Drops the done rows from the queue and notes the error on each failed one. */
  complete(doneIds: number[], failed: { id: number; error: string }[]): Promise<void>
}

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : 'remove failed'

/**
 * One cleanup run: queue stale uploads and orphans, claim a batch, remove those files, and
 * report back which rows are done and which failed (they stay queued for the next run). If the
 * remove call throws, every claimed row fails with its message.
 */
export async function runCleanup(deps: CleanupDeps): Promise<{ removed: number; failed: number }> {
  await deps.enqueueStale()
  const rows = await deps.claim(CLAIM_LIMIT)
  if (rows.length === 0) return { removed: 0, failed: 0 }

  let failedPaths: Set<string>
  let reason = 'storage did not remove the file'
  try {
    failedPaths = new Set((await deps.remove(rows.map((row) => row.storage_path))).failed)
  } catch (error) {
    failedPaths = new Set(rows.map((row) => row.storage_path))
    reason = messageOf(error)
  }

  const done = rows.filter((row) => !failedPaths.has(row.storage_path)).map((row) => row.id)
  const failed = rows
    .filter((row) => failedPaths.has(row.storage_path))
    .map((row) => ({ id: row.id, error: reason }))
  await deps.complete(done, failed)
  return { removed: done.length, failed: failed.length }
}

/**
 * The storage-cleanup Edge Function, called by the pg_cron job every 5 minutes. Only a caller
 * presenting the service role key may run it; it answers the run's counts as JSON.
 */
export function cleanupHandler(deps: CleanupDeps & { serviceKey: string }) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return appError(405, 'VALIDATION', { allow: 'POST' })
    if (!sameSecret(bearerToken(req) ?? '', deps.serviceKey)) {
      return appError(401, 'UNAUTHENTICATED')
    }

    try {
      return json(200, await runCleanup(deps))
    } catch (error) {
      console.error('storage-cleanup failed', error)
      return appError(500, 'UNKNOWN')
    }
  }
}
