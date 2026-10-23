// Takes personal data out of what is sent to Sentry. Spec section 9: no names, emails or file
// paths. Text can be matched for emails, paths and tokens; names cannot, so the app keeps them out
// of the events instead (no console, touch or label breadcrumbs, no screenshots; see sentry.ts).

const EMAIL = /[\p{L}\p{N}._%+-]{1,64}(?:@|%40)[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63}){1,8}/giu
/** `<owner>/<pet>` and `<owner>/<pet>/<photo>.jpg`, the shape of a storage path. */
const STORAGE_PATH = /[0-9a-f-]{36}\/[0-9a-f-]{36}(\/[0-9a-f-]{36}\.jpg)?/gi
/** The value of a `token=` query parameter, which is what makes a signed URL work. */
const TOKEN_PARAMETER = /\b([a-z_]{0,20}token)=[^&\s"'#)\]]+/gi
const JSON_WEB_TOKEN = /\beyJ[\w-]+\.[\w-]+\.[\w-]*/g
const FILE_URI = /\bfile:\/\/[^\s"')\]]+/gi
/** The account name in `/Users/<name>/…` and `/home/<name>/…`. */
const HOME_FOLDER = /(\/(?:Users|home)\/)[^/\s]+/g

/** The text with emails, storage and file paths, and tokens replaced. */
export function scrubString(text: string): string {
  return text
    .replace(TOKEN_PARAMETER, '$1=[redacted]')
    .replace(JSON_WEB_TOKEN, '[token]')
    .replace(FILE_URI, '[path]')
    .replace(EMAIL, '[email]')
    .replace(STORAGE_PATH, '[path]')
    .replace(HOME_FOLDER, '$1[user]')
}

/** How far down, and how many values, one scrub looks at before it cuts the rest off. */
const MAX_DEPTH = 20
const MAX_VALUES = 50_000
const TRUNCATED = '[truncated]'
const UNREADABLE = '[unreadable]'

type Walk = {
  /** Values (strings and objects) still allowed. */
  remaining: number
  /** Each object already copied, so a cycle or a shared object is copied once. */
  copies: WeakMap<object, unknown>
}

const newWalk = (): Walk => ({ remaining: MAX_VALUES, copies: new WeakMap() })

function take(walk: Walk): boolean {
  walk.remaining -= 1
  return walk.remaining >= 0
}

/**
 * A copy of `value` with every string scrubbed. Whatever is too deep or too much to check is
 * replaced by "[truncated]" rather than passed on unchecked; a property that throws when read
 * becomes "[unreadable]". It does not throw.
 */
function scrubValue(value: unknown, depth: number, walk: Walk): unknown {
  if (typeof value === 'string') return take(walk) ? scrubString(value) : TRUNCATED
  if (typeof value !== 'object' || value === null) return value

  const known = walk.copies.get(value)
  if (known !== undefined) return known
  if (depth >= MAX_DEPTH || !take(walk)) return TRUNCATED

  if (Array.isArray(value)) {
    const copy: unknown[] = []
    walk.copies.set(value, copy)
    for (let index = 0; index < value.length; index += 1) {
      if (walk.remaining <= 0) {
        copy.push(TRUNCATED)
        break
      }
      copy.push(read(() => scrubValue(value[index], depth + 1, walk)))
    }
    return copy
  }

  const copy: Record<string, unknown> = {}
  walk.copies.set(value, copy)
  // An Error keeps its message and stack in non-enumerable properties.
  const keys = value instanceof Error ? Object.getOwnPropertyNames(value) : Object.keys(value)
  for (const key of keys) {
    if (key === '__proto__') continue
    copy[key] = read(() => scrubValue((value as Record<string, unknown>)[key], depth + 1, walk))
  }
  return copy
}

function read(scrub: () => unknown): unknown {
  try {
    return scrub()
  } catch {
    return UNREADABLE
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/**
 * Breadcrumbs that are not kept at all: console output can carry any logged value, and a touch
 * or click breadcrumb carries the label of what was pressed, such as a pet's name.
 */
function isDropped(breadcrumb: object): boolean {
  const category = (breadcrumb as { category?: unknown }).category
  if (typeof category !== 'string') return false
  return (
    category === 'console' ||
    category === 'touch' ||
    (category.startsWith('ui.') && category !== 'ui.lifecycle')
  )
}

/** The breadcrumb with its text scrubbed, or null for one that is not kept. */
export function scrubBreadcrumb<B extends object>(breadcrumb: B): B | null {
  if (isDropped(breadcrumb)) return null
  return scrubValue(breadcrumb, 0, newWalk()) as B
}

/**
 * The event with personal data removed, for Sentry's `beforeSend`: its user (except the id), its
 * request and the device name are removed, and every string anywhere in it is scrubbed. That
 * covers messages, exceptions and their stack frames, breadcrumbs, extra, contexts and tags.
 * The event passed in is not changed.
 */
export function scrubEvent<
  E extends {
    user?: object
    request?: object
    message?: string
    exception?: { values?: { value?: string }[] }
  },
>(event: E): E {
  const scrubbed = scrubValue(event, 0, newWalk()) as Record<string, unknown>

  delete scrubbed.request

  const { user } = scrubbed
  delete scrubbed.user
  if (isRecord(user) && user.id !== undefined) scrubbed.user = { id: user.id }

  if (Array.isArray(scrubbed.breadcrumbs)) {
    scrubbed.breadcrumbs = scrubbed.breadcrumbs.filter(
      (breadcrumb: unknown) => !(isRecord(breadcrumb) && isDropped(breadcrumb)),
    )
  }

  const device = isRecord(scrubbed.contexts) ? scrubbed.contexts.device : undefined
  if (isRecord(device)) delete device.name

  return scrubbed as E
}
