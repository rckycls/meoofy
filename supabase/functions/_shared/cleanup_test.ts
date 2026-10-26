import assert from 'node:assert/strict'
import { CLAIM_LIMIT, cleanupHandler, runCleanup, type CleanupDeps } from './cleanup.ts'

type Row = { id: number; storage_path: string }

const ROWS: Row[] = [
  { id: 11, storage_path: 'u/p/a.jpg' },
  { id: 12, storage_path: 'u/p/b.jpg' },
  { id: 13, storage_path: 'u/p/c.jpg' },
]

/** Fake dependencies that log every call, in order. */
function fakeDeps(rows: Row[], overrides: Partial<CleanupDeps> = {}) {
  const calls: string[] = []
  const completed: { done: number[]; failed: { id: number; error: string }[] }[] = []
  const removed: string[][] = []
  const deps: CleanupDeps = {
    enqueueStale: () => {
      calls.push('enqueueStale')
      return Promise.resolve(2)
    },
    claim: (limit) => {
      calls.push(`claim ${limit}`)
      return Promise.resolve(rows)
    },
    remove: (paths) => {
      calls.push(`remove ${paths.length}`)
      removed.push(paths)
      return Promise.resolve({ failed: [] })
    },
    complete: (done, failed) => {
      calls.push('complete')
      completed.push({ done, failed })
      return Promise.resolve()
    },
    ...overrides,
  }
  return { deps, calls, completed, removed }
}

// ---------------------------------------------------------------------------
// runCleanup
// ---------------------------------------------------------------------------

Deno.test(
  'runCleanup with 3 claimed rows where 1 path fails removes 2 and reports 1 failure',
  async () => {
    const { deps, completed, removed } = fakeDeps(ROWS, {
      remove: (paths) => {
        removed.push(paths)
        return Promise.resolve({ failed: ['u/p/b.jpg'] })
      },
    })

    const result = await runCleanup(deps)

    assert.deepEqual(result, { removed: 2, failed: 1 })
    assert.deepEqual(removed, [['u/p/a.jpg', 'u/p/b.jpg', 'u/p/c.jpg']])
    assert.equal(completed.length, 1)
    assert.deepEqual(completed[0]?.done, [11, 13])
    assert.equal(completed[0]?.failed.length, 1)
    assert.equal(completed[0]?.failed[0]?.id, 12)
    assert.equal(typeof completed[0]?.failed[0]?.error, 'string')
    assert.ok(completed[0]?.failed[0]?.error, 'the failure carries a reason')
  },
)

Deno.test(
  'runCleanup queues stale uploads first, then claims at most CLAIM_LIMIT rows',
  async () => {
    const { deps, calls } = fakeDeps(ROWS)

    const result = await runCleanup(deps)

    assert.equal(CLAIM_LIMIT, 1000, 'one Storage remove call takes at most 1000 paths')
    assert.deepEqual(calls, ['enqueueStale', `claim ${CLAIM_LIMIT}`, 'remove 3', 'complete'])
    assert.deepEqual(result, { removed: 3, failed: 0 })
  },
)

Deno.test('runCleanup with nothing claimed removes nothing and completes nothing', async () => {
  const { deps, calls } = fakeDeps([])

  const result = await runCleanup(deps)

  assert.deepEqual(result, { removed: 0, failed: 0 })
  assert.deepEqual(calls, ['enqueueStale', `claim ${CLAIM_LIMIT}`])
})

Deno.test(
  'runCleanup marks every claimed row failed, with the reason, when remove throws',
  async () => {
    const { deps, completed } = fakeDeps(ROWS, {
      remove: () => Promise.reject(new Error('storage timed out')),
    })

    const result = await runCleanup(deps)

    assert.deepEqual(result, { removed: 0, failed: 3 })
    assert.deepEqual(completed, [
      {
        done: [],
        failed: [
          { id: 11, error: 'storage timed out' },
          { id: 12, error: 'storage timed out' },
          { id: 13, error: 'storage timed out' },
        ],
      },
    ])
  },
)

Deno.test(
  'runCleanup lets a failing complete reject, so the run is reported as failed',
  async () => {
    const { deps } = fakeDeps(ROWS, {
      complete: () => Promise.reject(new Error('db down')),
    })

    await assert.rejects(runCleanup(deps), /db down/)
  },
)

// ---------------------------------------------------------------------------
// cleanupHandler: the HTTP contract of the storage-cleanup function
// ---------------------------------------------------------------------------

const SERVICE_KEY = 'service-role-key-for-tests'

const request = (init: RequestInit = {}) =>
  new Request('http://localhost/functions/v1/storage-cleanup', { method: 'POST', ...init })

Deno.test('storage-cleanup refuses callers without the service role key', async () => {
  for (const headers of [
    {} as Record<string, string>,
    { Authorization: 'Bearer anon-key' },
    { Authorization: `Bearer ${SERVICE_KEY}x` },
    { Authorization: SERVICE_KEY },
  ]) {
    const { deps, calls } = fakeDeps(ROWS)
    const res = await cleanupHandler({ ...deps, serviceKey: SERVICE_KEY })(request({ headers }))
    assert.equal(res.status, 401, JSON.stringify(headers))
    assert.deepEqual(await res.json(), { error: 'MEOOFY:UNAUTHENTICATED' })
    assert.deepEqual(calls, [], 'nothing runs')
  }
})

Deno.test('storage-cleanup refuses everyone when no service key is configured', async () => {
  const { deps, calls } = fakeDeps(ROWS)

  const res = await cleanupHandler({ ...deps, serviceKey: '' })(
    request({ headers: { Authorization: 'Bearer ' } }),
  )

  assert.equal(res.status, 401)
  await res.body?.cancel()
  assert.deepEqual(calls, [])
})

Deno.test(
  'storage-cleanup with the service role key runs one cleanup and answers its counts',
  async () => {
    const { deps, calls } = fakeDeps(ROWS)

    const res = await cleanupHandler({ ...deps, serviceKey: SERVICE_KEY })(
      request({ headers: { Authorization: `Bearer ${SERVICE_KEY}` } }),
    )

    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { removed: 3, failed: 0 })
    assert.deepEqual(calls, ['enqueueStale', `claim ${CLAIM_LIMIT}`, 'remove 3', 'complete'])
  },
)

Deno.test('storage-cleanup answers 500 when the run fails', async () => {
  const { deps } = fakeDeps(ROWS, { claim: () => Promise.reject(new Error('db down')) })
  const quiet = console.error
  console.error = () => {}
  try {
    const res = await cleanupHandler({ ...deps, serviceKey: SERVICE_KEY })(
      request({ headers: { Authorization: `Bearer ${SERVICE_KEY}` } }),
    )
    assert.equal(res.status, 500)
    assert.deepEqual(await res.json(), { error: 'MEOOFY:UNKNOWN' })
  } finally {
    console.error = quiet
  }
})

Deno.test('storage-cleanup accepts only POST', async () => {
  const { deps, calls } = fakeDeps(ROWS)

  const res = await cleanupHandler({ ...deps, serviceKey: SERVICE_KEY })(
    request({ method: 'GET', headers: { Authorization: `Bearer ${SERVICE_KEY}` } }),
  )

  assert.equal(res.status, 405)
  assert.equal(res.headers.get('allow'), 'POST')
  await res.body?.cancel()
  assert.deepEqual(calls, [])
})
