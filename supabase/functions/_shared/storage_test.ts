import assert from 'node:assert/strict'
import { LIST_PAGE_SIZE, listAllPaths, type StorageEntry } from './storage.ts'

const UID = '0b5f3c1e-8f0a-4c2b-9d7e-1a2b3c4d5e6f'

/**
 * A fake Storage `list`: one level of `files` (full paths) under `folder`, paged like the
 * Storage API, with sub-folders reported as entries whose id is null.
 */
function fakeList(files: string[]) {
  const calls: string[] = []
  const list = (folder: string, offset: number, limit: number): Promise<StorageEntry[]> => {
    calls.push(`${folder} @${offset}`)
    const level = new Map<string, StorageEntry>()
    for (const file of files) {
      if (!file.startsWith(`${folder}/`)) continue
      const [name, ...rest] = file.slice(folder.length + 1).split('/')
      if (name === undefined) continue
      level.set(name, { name, id: rest.length > 0 ? null : `id-${file}` })
    }
    const sorted = [...level.values()].sort((a, b) => a.name.localeCompare(b.name))
    return Promise.resolve(sorted.slice(offset, offset + limit))
  }
  return { list, calls }
}

Deno.test(
  'listAllPaths walks every folder under the prefix and pages through big folders',
  async () => {
    const petA = Array.from(
      { length: 1500 },
      (_, i) => `${UID}/pet-a/${String(i).padStart(4, '0')}.jpg`,
    )
    const files = [
      ...petA,
      `${UID}/pet-b/1.jpg`,
      `${UID}/pet-b/2.jpg`,
      `${UID}/stray.jpg`,
      `${UID}/deep/x/y/z.jpg`,
      `other-user/pet/1.jpg`,
    ]
    const { list, calls } = fakeList(files)

    const paths = await listAllPaths(list, `${UID}/`)

    assert.deepEqual(
      [...paths].sort(),
      files.filter((f) => f.startsWith(`${UID}/`)).sort(),
      'every file under the prefix, and nothing else',
    )
    assert.equal(LIST_PAGE_SIZE, 1000)
    assert.ok(calls.includes(`${UID}/pet-a @0`))
    assert.ok(calls.includes(`${UID}/pet-a @1000`), 'a folder bigger than one page is paged')
    assert.ok(!calls.includes(`${UID}/pet-b @1000`), 'a short page ends the folder')
  },
)

Deno.test('listAllPaths treats a prefix with or without the trailing slash the same', async () => {
  const files = [`${UID}/pet/1.jpg`]
  assert.deepEqual(await listAllPaths(fakeList(files).list, UID), files)
  assert.deepEqual(await listAllPaths(fakeList(files).list, `${UID}/`), files)
})

Deno.test('listAllPaths of an empty folder is empty', async () => {
  assert.deepEqual(await listAllPaths(fakeList([]).list, `${UID}/`), [])
})

Deno.test('listAllPaths refuses an empty prefix (the bucket root)', async () => {
  const { list, calls } = fakeList([`${UID}/pet/1.jpg`])
  for (const prefix of ['', '/', '//']) {
    await assert.rejects(listAllPaths(list, prefix), /prefix/)
  }
  assert.deepEqual(calls, [])
})

Deno.test('listAllPaths passes listing errors through', async () => {
  await assert.rejects(
    listAllPaths(() => Promise.reject(new Error('list failed')), UID),
    /list failed/,
  )
})
