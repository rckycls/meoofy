/** One entry of a Storage folder listing. Sub-folders have a null id. */
export interface StorageEntry {
  name: string
  id: string | null
}

/** One page of a Storage folder listing (supabase-js `storage.from(bucket).list`). */
export type ListPage = (folder: string, offset: number, limit: number) => Promise<StorageEntry[]>

/** Entries asked for per listing call. */
export const LIST_PAGE_SIZE = 1000

/**
 * Every object path under `prefix` (`'a'` and `'a/'` mean the same folder), at any depth.
 * Storage lists one folder level at a time, so this descends into each sub-folder and pages
 * through folders bigger than one page. The bucket root is refused: nothing here should ever
 * enumerate every user's files.
 */
export async function listAllPaths(listPage: ListPage, prefix: string): Promise<string[]> {
  const root = prefix.replace(/\/+$/, '')
  if (root.length === 0) throw new Error('listAllPaths: prefix must name a folder')

  const paths: string[] = []
  const folders = [root]
  for (let folder = folders.pop(); folder !== undefined; folder = folders.pop()) {
    for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
      const page = await listPage(folder, offset, LIST_PAGE_SIZE)
      for (const entry of page) {
        const path = `${folder}/${entry.name}`
        if (entry.id === null) folders.push(path)
        else paths.push(path)
      }
      if (page.length < LIST_PAGE_SIZE) break
    }
  }
  return paths
}
