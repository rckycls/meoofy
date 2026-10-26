import assert from 'node:assert/strict'
import {
  deleteAccount,
  deleteAccountHandler,
  type DeleteAccountHandlerDeps,
} from './deleteAccount.ts'

const UID = '0b5f3c1e-8f0a-4c2b-9d7e-1a2b3c4d5e6f'

/** Fake dependencies that log every call, in order, as one line each. */
function fakeDeps(paths: string[], overrides: Partial<DeleteAccountHandlerDeps> = {}) {
  const calls: string[] = []
  const removed: string[][] = []
  const deps: DeleteAccountHandlerDeps = {
    listPaths: (prefix) => {
      calls.push(`list ${prefix}`)
      return Promise.resolve(paths)
    },
    removePaths: (chunk) => {
      calls.push(`remove ${chunk.length}`)
      removed.push(chunk)
      return Promise.resolve()
    },
    recordAudit: (action) => {
      calls.push(`audit ${action}`)
      return Promise.resolve()
    },
    deleteUser: (uid) => {
      calls.push(`deleteUser ${uid}`)
      return Promise.resolve()
    },
    userIdFromJwt: (jwt) => {
      calls.push(`verify ${jwt}`)
      return Promise.resolve(jwt === 'good-token' ? UID : null)
    },
    ...overrides,
  }
  return { deps, calls, removed }
}

const filesOf = (uid: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${uid}/pet/${i}.jpg`)

// ---------------------------------------------------------------------------
// deleteAccount
// ---------------------------------------------------------------------------

Deno.test(
  'deleteAccount removes 2500 files in chunks of 1000, then records account.deleted, then deletes the user',
  async () => {
    const paths = filesOf(UID, 2500)
    const { deps, calls, removed } = fakeDeps(paths)

    await deleteAccount(UID, deps)

    assert.deepEqual(calls, [
      `list ${UID}/`,
      'remove 1000',
      'remove 1000',
      'remove 500',
      'audit account.deleted',
      `deleteUser ${UID}`,
    ])
    assert.deepEqual(removed.flat(), paths, 'every listed file is removed exactly once')
  },
)

Deno.test('deleteAccount does not delete the user when removing files fails', async () => {
  const { deps, calls } = fakeDeps(filesOf(UID, 3), {
    removePaths: () => Promise.reject(new Error('storage is down')),
  })

  await assert.rejects(deleteAccount(UID, deps), /storage is down/)

  assert.deepEqual(calls, [`list ${UID}/`], 'no audit event and no user deletion')
})

Deno.test('deleteAccount does not delete the user when listing files fails', async () => {
  const { deps, calls } = fakeDeps([], {
    listPaths: () => Promise.reject(new Error('list failed')),
  })

  await assert.rejects(deleteAccount(UID, deps), /list failed/)

  assert.deepEqual(calls, [])
})

Deno.test('deleteAccount with no files records the event and deletes the user', async () => {
  const { deps, calls } = fakeDeps([])

  await deleteAccount(UID, deps)

  assert.deepEqual(calls, [`list ${UID}/`, 'audit account.deleted', `deleteUser ${UID}`])
})

Deno.test(
  'deleteAccount refuses a uid that is not a uuid, so it can never list the whole bucket',
  async () => {
    for (const uid of ['', '/', '../etc', 'not-a-uuid', `${UID}/x`]) {
      const { deps, calls } = fakeDeps(filesOf(UID, 1))
      await assert.rejects(deleteAccount(uid, deps), /uuid/, `uid ${JSON.stringify(uid)}`)
      assert.deepEqual(calls, [], `nothing is touched for uid ${JSON.stringify(uid)}`)
    }
  },
)

Deno.test('deleteAccount refuses to remove a listed path outside the user folder', async () => {
  const other = '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f'
  const { deps, calls } = fakeDeps([`${UID}/pet/a.jpg`, `${other}/pet/b.jpg`])

  await assert.rejects(deleteAccount(UID, deps), /outside/)

  assert.deepEqual(calls, [`list ${UID}/`], 'nothing is removed and the user is kept')
})

// ---------------------------------------------------------------------------
// deleteAccountHandler: the HTTP contract of the delete-account function
// ---------------------------------------------------------------------------

const request = (init: RequestInit = {}) =>
  new Request('http://localhost/functions/v1/delete-account', { method: 'POST', ...init })

const unauthenticated = { error: 'MEOOFY:UNAUTHENTICATED' }

Deno.test(
  'delete-account without an Authorization header answers 401 UNAUTHENTICATED',
  async () => {
    const { deps, calls } = fakeDeps(filesOf(UID, 2))

    const res = await deleteAccountHandler(deps)(request())

    assert.equal(res.status, 401)
    assert.deepEqual(await res.json(), unauthenticated)
    assert.equal(res.headers.get('content-type'), 'application/json')
    assert.deepEqual(calls, [], 'nothing is verified or deleted')
  },
)

Deno.test('delete-account with a malformed Authorization header answers 401', async () => {
  for (const header of ['good-token', 'Basic good-token', 'Bearer', 'Bearer   ']) {
    const { deps, calls } = fakeDeps([])
    const res = await deleteAccountHandler(deps)(request({ headers: { Authorization: header } }))
    assert.equal(res.status, 401, header)
    assert.deepEqual(await res.json(), unauthenticated)
    assert.deepEqual(calls, [], header)
  }
})

Deno.test(
  'delete-account with a JWT that does not verify answers 401 and deletes nothing',
  async () => {
    const { deps, calls } = fakeDeps(filesOf(UID, 2))

    const res = await deleteAccountHandler(deps)(
      request({ headers: { Authorization: 'Bearer forged-token' } }),
    )

    assert.equal(res.status, 401)
    assert.deepEqual(await res.json(), unauthenticated)
    assert.deepEqual(calls, ['verify forged-token'])
  },
)

Deno.test(
  'delete-account with a valid JWT deletes that user and answers 204 with no body',
  async () => {
    const { deps, calls } = fakeDeps(filesOf(UID, 2))

    const res = await deleteAccountHandler(deps)(
      request({ headers: { authorization: 'bearer good-token' } }),
    )

    assert.equal(res.status, 204)
    assert.equal(await res.text(), '')
    assert.deepEqual(calls, [
      'verify good-token',
      `list ${UID}/`,
      'remove 2',
      'audit account.deleted',
      `deleteUser ${UID}`,
    ])
  },
)

Deno.test('delete-account answers 500 and keeps the user when file removal fails', async () => {
  const { deps, calls } = fakeDeps(filesOf(UID, 2), {
    removePaths: () => Promise.reject(new Error('storage is down')),
  })
  const quiet = console.error
  console.error = () => {}
  try {
    const res = await deleteAccountHandler(deps)(
      request({ headers: { Authorization: 'Bearer good-token' } }),
    )
    assert.equal(res.status, 500)
    assert.deepEqual(await res.json(), { error: 'MEOOFY:UNKNOWN' })
  } finally {
    console.error = quiet
  }
  assert.deepEqual(calls, ['verify good-token', `list ${UID}/`])
})

Deno.test('delete-account answers 500 when the JWT check itself fails (not a 401)', async () => {
  const { deps, calls } = fakeDeps([], {
    userIdFromJwt: () => Promise.reject(new Error('auth is down')),
  })
  const quiet = console.error
  console.error = () => {}
  try {
    const res = await deleteAccountHandler(deps)(
      request({ headers: { Authorization: 'Bearer good-token' } }),
    )
    assert.equal(res.status, 500)
    assert.deepEqual(await res.json(), { error: 'MEOOFY:UNKNOWN' })
  } finally {
    console.error = quiet
  }
  assert.deepEqual(calls, [])
})

Deno.test('delete-account accepts only POST', async () => {
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const { deps, calls } = fakeDeps([])
    const res = await deleteAccountHandler(deps)(
      request({ method, headers: { Authorization: 'Bearer good-token' } }),
    )
    assert.equal(res.status, 405, method)
    assert.equal(res.headers.get('allow'), 'POST, OPTIONS')
    assert.deepEqual(await res.json(), { error: 'MEOOFY:VALIDATION' })
    assert.deepEqual(calls, [], method)
  }
})

Deno.test(
  'delete-account answers the browser CORS preflight and marks every response for CORS',
  async () => {
    const { deps, calls } = fakeDeps([])
    const handler = deleteAccountHandler(deps)

    const preflight = await handler(request({ method: 'OPTIONS' }))
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers.get('access-control-allow-origin'), '*')
    assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /authorization/)
    assert.match(preflight.headers.get('access-control-allow-methods') ?? '', /POST/)
    assert.deepEqual(calls, [])

    const denied = await handler(request())
    assert.equal(denied.headers.get('access-control-allow-origin'), '*')
    await denied.body?.cancel()

    const done = await handler(request({ headers: { Authorization: 'Bearer good-token' } }))
    assert.equal(done.headers.get('access-control-allow-origin'), '*')
  },
)
