import { scrubBreadcrumb, scrubEvent, scrubString } from './scrub'

const OWNER = '3f2b8c1e-5a7d-4e0b-9c64-1d2e3f4a5b6c'
const PET = '7a9d0e21-8b3c-4f5a-a1b2-c3d4e5f60718'
const PHOTO = '0c1d2e3f-4a5b-4c6d-8e7f-90a1b2c3d4e5'
const STORAGE_PATH = `${OWNER}/${PET}/${PHOTO}.jpg`
/**
 * `scrubEvent` asks for an event with at least one of a few named fields. Events under test that
 * name only others (breadcrumbs, extra, contexts) are given `message` as a type, so TypeScript's
 * check for an object with nothing in common with that type does not reject them.
 */
const asEvent = <T extends object>(fields: T) => fields as T & { message?: string }

const SIGNED_URL = `https://x.supabase.co/storage/v1/object/sign/pet-photos/${STORAGE_PATH}?token=eyJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJwZXQifQ.c2lnbmF0dXJl`

describe('scrubString', () => {
  it('replaces emails', () => {
    expect(scrubString('failed for a@b.co')).toBe('failed for [email]')
    expect(scrubString('first.last+tag@mail.example.co.uk and x_y@z.io')).toBe(
      '[email] and [email]',
    )
    // The same address inside a URL's query string.
    expect(scrubString('/auth/v1/user?email=alex%40example.com&x=1')).toBe(
      '/auth/v1/user?email=[email]&x=1',
    )
  })

  it('leaves the full stop after an address alone', () => {
    expect(scrubString('Could not send to a@b.co.')).toBe('Could not send to [email].')
  })

  it('replaces owner/pet and owner/pet/photo storage paths, in either letter case', () => {
    expect(scrubString(`upload ${STORAGE_PATH} failed`)).toBe('upload [path] failed')
    expect(scrubString(`row ${OWNER}/${PET} missing`)).toBe('row [path] missing')
    expect(scrubString(STORAGE_PATH.toUpperCase().replace('.JPG', '.jpg'))).toBe('[path]')
  })

  it('leaves a lone uuid alone', () => {
    expect(scrubString(`pet ${PET} not found`)).toBe(`pet ${PET} not found`)
  })

  it('strips signed-URL token values and the path before them', () => {
    expect(scrubString(`GET ${SIGNED_URL}`)).toBe(
      'GET https://x.supabase.co/storage/v1/object/sign/pet-photos/[path]?token=[redacted]',
    )
  })

  it('redacts access and refresh tokens in a URL, keeping the other parameters', () => {
    expect(scrubString('https://x.test/cb#access_token=abc.def&refresh_token=ghi&type=magic')).toBe(
      'https://x.test/cb#access_token=[redacted]&refresh_token=[redacted]&type=magic',
    )
  })

  it('replaces a bare JWT', () => {
    expect(scrubString('bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.c2ln')).toBe('bearer [token]')
  })

  it('replaces file URIs and the user name in a home folder path', () => {
    expect(scrubString('cannot read file:///var/mobile/Containers/Data/a/b/photo.jpg now')).toBe(
      'cannot read [path] now',
    )
    expect(scrubString('at /Users/rocky/work/meoofy/src/a.ts:3')).toBe(
      'at /Users/[user]/work/meoofy/src/a.ts:3',
    )
  })

  it('leaves ordinary text alone', () => {
    expect(scrubString('Network request failed (status 503)')).toBe(
      'Network request failed (status 503)',
    )
  })
})

describe('scrubEvent', () => {
  it('scrubs breadcrumb messages and the strings in their data', () => {
    const event = {
      breadcrumbs: [
        {
          category: 'fetch',
          message: 'sent to a@b.co',
          data: { url: SIGNED_URL, status_code: 200 },
        },
        { category: 'navigation', data: { to: `/pets/${PET}`, nested: { who: 'a@b.co' } } },
      ],
    }

    expect(scrubEvent(asEvent(event))).toEqual({
      breadcrumbs: [
        {
          category: 'fetch',
          message: 'sent to [email]',
          data: {
            url: 'https://x.supabase.co/storage/v1/object/sign/pet-photos/[path]?token=[redacted]',
            status_code: 200,
          },
        },
        { category: 'navigation', data: { to: `/pets/${PET}`, nested: { who: '[email]' } } },
      ],
    })
  })

  it('drops console and user-interaction breadcrumbs, which can carry any logged value or label', () => {
    const kept = { category: 'navigation', message: 'to /home' }
    const event = {
      breadcrumbs: [
        { category: 'console', message: 'Milo is 3' },
        { category: 'touch', message: 'Touch event within element: Milo, Golden retriever' },
        { category: 'ui.click', message: 'button[aria-label="Milo"]' },
        { category: 'ui.input', message: 'input[aria-label="Pet’s name"]' },
        kept,
        { category: 'ui.lifecycle', message: 'viewDidLoad' },
      ],
    }

    expect(scrubEvent(asEvent(event)).breadcrumbs).toEqual([
      kept,
      { category: 'ui.lifecycle', message: 'viewDidLoad' },
    ])
  })

  it('scrubs the string values in extra, contexts, tags and the transaction, at any depth', () => {
    const event = {
      extra: { note: 'for a@b.co', list: ['ok', `${OWNER}/${PET}`], deep: { a: { b: 'a@b.co' } } },
      contexts: { custom: { photo: STORAGE_PATH, count: 3, flag: true, none: null } },
      tags: { page: 'a@b.co' },
      transaction: `/pets/${OWNER}/${PET}`,
    }

    expect(scrubEvent(asEvent(event))).toEqual({
      extra: { note: 'for [email]', list: ['ok', '[path]'], deep: { a: { b: '[email]' } } },
      contexts: { custom: { photo: '[path]', count: 3, flag: true, none: null } },
      tags: { page: '[email]' },
      transaction: '/pets/[path]',
    })
  })

  it('scrubs every exception value and stack frame, including the cause chain', () => {
    const event = {
      exception: {
        values: [
          { type: 'AppError', value: `no row for ${OWNER}/${PET}` },
          {
            type: 'Error',
            value: 'read file:///var/mobile/x/y.jpg',
            stacktrace: { frames: [{ filename: '/Users/rocky/meoofy/src/a.ts', lineno: 3 }] },
          },
        ],
      },
    }

    expect(scrubEvent(asEvent(event))).toEqual({
      exception: {
        values: [
          { type: 'AppError', value: 'no row for [path]' },
          {
            type: 'Error',
            value: 'read [path]',
            stacktrace: { frames: [{ filename: '/Users/[user]/meoofy/src/a.ts', lineno: 3 }] },
          },
        ],
      },
    })
  })

  it('removes the device name', () => {
    const event = { contexts: { device: { name: 'Rocky’s iPhone', model: 'iPhone15,2' } } }
    expect(scrubEvent(asEvent(event)).contexts).toEqual({ device: { model: 'iPhone15,2' } })
  })

  it('drops a user that has no id, and keeps only the id of one that has', () => {
    expect(scrubEvent({ user: { email: 'a@b.co', username: 'milo' } })).toEqual({})
    expect(
      scrubEvent({ user: { id: 'u1', email: 'a@b.co', ip_address: '1.2.3.4', username: 'milo' } }),
    ).toEqual({ user: { id: 'u1' } })
  })

  it('does not change the event it is given', () => {
    const event = {
      user: { id: 'u1', email: 'a@b.co' },
      request: { url: 'https://x.test/?token=abc' },
      message: 'failed for a@b.co',
      breadcrumbs: [{ category: 'console', message: 'hi' }],
    }
    const before = structuredClone(event)

    scrubEvent(event)

    expect(event).toEqual(before)
  })

  describe('never throws', () => {
    it('on a cyclic object, keeping the cycle and scrubbing what is in it', () => {
      const extra: Record<string, unknown> = { note: 'a@b.co' }
      extra.self = extra
      extra.list = [extra]

      let result: { extra: Record<string, unknown> } | undefined
      expect(() => {
        result = scrubEvent(asEvent({ extra }))
      }).not.toThrow()

      expect(result?.extra.note).toBe('[email]')
      expect(result?.extra.self).toBe(result?.extra)
      expect((result?.extra.list as unknown[])[0]).toBe(result?.extra)
    })

    it('on a very deep object, cutting it off instead of walking all of it', () => {
      let deep: Record<string, unknown> = { leaf: 'a@b.co' }
      for (let i = 0; i < 20_000; i += 1) deep = { next: deep }

      let result: unknown
      expect(() => {
        result = scrubEvent(asEvent({ extra: deep }))
      }).not.toThrow()

      const text = JSON.stringify(result)
      expect(text).toContain('[truncated]')
      // What is cut off is not passed on unchecked.
      expect(text).not.toContain('a@b.co')
    })

    it('on a very wide object, cutting off what comes after the size limit', () => {
      const list = Array.from({ length: 200_000 }, (_, i) => `a${i}@b.co`)

      let result: { extra: { list: string[] } } | undefined
      expect(() => {
        result = scrubEvent(asEvent({ extra: { list } }))
      }).not.toThrow()

      const scrubbed = result?.extra.list ?? []
      expect(scrubbed[0]).toBe('[email]')
      expect(scrubbed.at(-1)).toBe('[truncated]')
      expect(scrubbed.some((item) => item.includes('@'))).toBe(false)
    })

    it('on a property that throws when read', () => {
      const extra = { fine: 'a@b.co' }
      Object.defineProperty(extra, 'broken', {
        enumerable: true,
        get() {
          throw new Error('nope')
        },
      })

      let result: { extra: Record<string, unknown> } | undefined
      expect(() => {
        result = scrubEvent(asEvent({ extra }))
      }).not.toThrow()

      expect(result?.extra).toEqual({ fine: '[email]', broken: '[unreadable]' })
    })
  })

  it('scrubs an Error left in extra, which would otherwise carry its message through', () => {
    const result = scrubEvent(asEvent({ extra: { error: new Error('failed for a@b.co') } }))

    expect(JSON.stringify(result)).not.toContain('a@b.co')
    expect(JSON.stringify(result)).toContain('failed for [email]')
  })
})

describe('scrubBreadcrumb', () => {
  it('drops console and user-interaction breadcrumbs', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'Milo' })).toBeNull()
    expect(scrubBreadcrumb({ category: 'touch', message: 'Milo' })).toBeNull()
    expect(scrubBreadcrumb({ category: 'ui.click', message: 'Milo' })).toBeNull()
  })

  it('scrubs the others and keeps their shape', () => {
    expect(
      scrubBreadcrumb({
        category: 'xhr',
        type: 'http',
        message: 'for a@b.co',
        data: { url: SIGNED_URL, method: 'GET', status_code: 200 },
      }),
    ).toEqual({
      category: 'xhr',
      type: 'http',
      message: 'for [email]',
      data: {
        url: 'https://x.supabase.co/storage/v1/object/sign/pet-photos/[path]?token=[redacted]',
        method: 'GET',
        status_code: 200,
      },
    })
  })

  it('keeps a breadcrumb that has no category', () => {
    expect(scrubBreadcrumb({ message: 'plain' })).toEqual({ message: 'plain' })
  })
})
