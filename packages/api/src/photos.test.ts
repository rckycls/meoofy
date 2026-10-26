// Photos without a network: the request → upload → confirm sequence, the storage call it makes
// (Ruling 21), signed URLs, row mapping and validation before requests.
import { AppError, LIMITS, type PhotoView } from '@meoofy/core'
import { describe, expect, it, vi } from 'vitest'
import { deletePhoto, isPhotoLimitReached, listPhotos, uploadPhoto } from './index'
import { offline, stubClient, type Fetch } from './testSupport'

const OWNER = '0b0b0b0b-1111-4222-8333-944455556666'
const PET = '6f1c1d4e-1111-4222-8333-944455556666'
const PHOTO = '7a2b3c4d-5555-4666-8777-988899990000'
const PATH = `${OWNER}/${PET}/${PHOTO}.jpg`

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A registry.pet_photos row as confirm_photo returns it (and api.pet_photos, minus a few). */
const readyRow = {
  id: PHOTO,
  pet_id: PET,
  owner_id: OWNER,
  view: 'front',
  status: 'ready',
  width: 1600,
  height: 1200,
  bytes: 4,
  blur_score: 300,
  brightness: 128,
  storage_path: PATH,
  created_at: '2026-10-23T09:00:00+00:00',
  confirmed_at: '2026-10-23T09:00:01+00:00',
}

type Call = { path: string; init: RequestInit | undefined }

/**
 * A fake Supabase that answers the upload flow's four requests. `upload` overrides the storage
 * answer, to play a duplicate or a refusal.
 */
function uploadServer(upload: () => Response = () => json(200, { Key: `pet-photos/${PATH}` })) {
  const calls: Call[] = []
  const fetch: Fetch = async (input, init) => {
    const path = new URL(String(input)).pathname
    calls.push({ path, init })
    switch (path) {
      case '/rest/v1/rpc/request_photo_upload':
        return json(200, PATH)
      case `/storage/v1/object/pet-photos/${PATH}`:
        return upload()
      case '/rest/v1/rpc/confirm_photo':
        return json(200, readyRow)
      case `/storage/v1/object/sign/pet-photos/${PATH}`:
        return json(200, { signedURL: `/object/sign/pet-photos/${PATH}?token=signed` })
      default:
        throw new Error(`unexpected request to ${path}`)
    }
  }
  return { fetch, calls, paths: () => calls.map((c) => c.path) }
}

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer
const args = {
  id: PHOTO,
  petId: PET,
  view: 'front' as PhotoView,
  jpeg,
  width: 1600,
  height: 1200,
  blurScore: 300,
  brightness: 128,
}

const bodyOf = (call: Call | undefined) => JSON.parse(String(call?.init?.body)) as unknown
const headersOf = (call: Call | undefined) => new Headers(call?.init?.headers)

describe('uploadPhoto', () => {
  it('requests a slot, uploads the bytes to it with a plain non-upsert upload, then confirms', async () => {
    const server = uploadServer()

    const photo = await uploadPhoto(stubClient(server.fetch), args)

    expect(server.paths()).toEqual([
      '/rest/v1/rpc/request_photo_upload',
      `/storage/v1/object/pet-photos/${PATH}`,
      '/rest/v1/rpc/confirm_photo',
      `/storage/v1/object/sign/pet-photos/${PATH}`,
    ])
    const [request, upload, confirm, sign] = server.calls
    expect(bodyOf(request)).toEqual({
      id: PHOTO,
      pet_id: PET,
      view: 'front',
      content_type: 'image/jpeg',
      bytes: 4,
    })
    // Ruling 21: never a signed upload URL, never upsert.
    expect(upload?.init?.method).toBe('POST')
    expect(headersOf(upload).get('x-upsert')).toBe('false')
    expect(headersOf(upload).get('content-type')).toBe('image/jpeg')
    expect(upload?.init?.body).toBe(jpeg)
    expect(bodyOf(confirm)).toEqual({
      id: PHOTO,
      width: 1600,
      height: 1200,
      blur_score: 300,
      brightness: 128,
    })
    expect(bodyOf(sign)).toEqual({ expiresIn: LIMITS.signedUrlSeconds })

    expect(photo).toEqual({
      id: PHOTO,
      petId: PET,
      view: 'front',
      status: 'ready',
      width: 1600,
      height: 1200,
      signedUrl: `http://stub.test/storage/v1/object/sign/pet-photos/${PATH}?token=signed`,
    })
  })

  it('a file already at the path (a retry after the upload got through) still confirms', async () => {
    const duplicate = () =>
      json(400, {
        statusCode: '409',
        error: 'Duplicate',
        message: 'The resource already exists',
        code: 'KeyAlreadyExists',
      })
    const server = uploadServer(duplicate)

    const photo = await uploadPhoto(stubClient(server.fetch), args)

    expect(server.paths()).toContain('/rest/v1/rpc/confirm_photo')
    expect(photo.status).toBe('ready')
  })

  it('any other storage refusal rejects with an AppError and does not confirm', async () => {
    const refused = () =>
      json(400, {
        statusCode: '403',
        error: 'Unauthorized',
        message: 'new row violates row-level security policy',
      })
    const server = uploadServer(refused)

    const error = await uploadPhoto(stubClient(server.fetch), args).catch((e: unknown) => e)

    expect(error).toMatchObject({ name: 'AppError' })
    expect(server.paths()).not.toContain('/rest/v1/rpc/confirm_photo')
  })

  it('a failed signed URL after the confirm still resolves: the photo is saved', async () => {
    const server = uploadServer()
    const fetch: Fetch = async (input, init) =>
      new URL(String(input)).pathname.startsWith('/storage/v1/object/sign/')
        ? offline(input, init)
        : server.fetch(input, init)

    const photo = await uploadPhoto(stubClient(fetch), args)

    expect(photo).toMatchObject({ id: PHOTO, status: 'ready', signedUrl: null })
  })

  it.each<[string, Partial<typeof args>]>([
    ['an empty file', { jpeg: new ArrayBuffer(0) }],
    ['a file over photoMaxBytes', { jpeg: new ArrayBuffer(LIMITS.photoMaxBytes + 1) }],
    ['a photo id that is not a uuid', { id: 'photo-1' }],
    ['a pet id that is not a uuid', { petId: 'pet-1' }],
    ['an unknown view', { view: 'back' as PhotoView }],
    ['a fractional width', { width: 1600.5 }],
    ['a zero height', { height: 0 }],
    ['a blur score that is not a number', { blurScore: Number.NaN }],
    ['an infinite brightness', { brightness: Number.POSITIVE_INFINITY }],
  ])('rejects %s as VALIDATION without a request', async (_label, change) => {
    const fetch = vi.fn(offline)
    await expect(uploadPhoto(stubClient(fetch), { ...args, ...change })).rejects.toMatchObject({
      name: 'AppError',
      code: 'VALIDATION',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a retry of a photo that is already confirmed returns it without uploading again', async () => {
    // The first attempt's confirm got through but its answer was lost; the server now refuses the
    // id for a new slot (VALIDATION), and the photo with that id is the one being retried.
    const calls: string[] = []
    const fetch: Fetch = async (input) => {
      const url = new URL(String(input))
      calls.push(url.pathname)
      if (url.pathname === '/rest/v1/rpc/request_photo_upload') {
        return json(400, { code: 'P0001', message: 'MEOOFY:VALIDATION' })
      }
      if (url.pathname === '/rest/v1/pet_photos') {
        expect(url.searchParams.get('id')).toBe(`eq.${PHOTO}`)
        return json(200, [readyRow])
      }
      if (url.pathname === `/storage/v1/object/sign/pet-photos/${PATH}`) {
        return json(200, { signedURL: `/object/sign/pet-photos/${PATH}?token=signed` })
      }
      throw new Error(`unexpected request to ${url.pathname}`)
    }

    const photo = await uploadPhoto(stubClient(fetch), args)

    expect(photo).toMatchObject({ id: PHOTO, status: 'ready', signedUrl: expect.any(String) })
    expect(calls).toEqual([
      '/rest/v1/rpc/request_photo_upload',
      '/rest/v1/pet_photos',
      `/storage/v1/object/sign/pet-photos/${PATH}`,
    ])
  })

  it.each([
    ['no photo has the id', []],
    ['the id belongs to a photo of another view', [{ ...readyRow, view: 'side' }]],
    ['the photo with the id is not ready', [{ ...readyRow, status: 'pending' }]],
  ])('a VALIDATION refusal of the slot is rethrown when %s', async (_label, rows) => {
    const fetch: Fetch = async (input) =>
      new URL(String(input)).pathname === '/rest/v1/rpc/request_photo_upload'
        ? json(400, { code: 'P0001', message: 'MEOOFY:VALIDATION' })
        : json(200, rows)
    await expect(uploadPhoto(stubClient(fetch), args)).rejects.toMatchObject({
      name: 'AppError',
      code: 'VALIDATION',
    })
  })

  it('surfaces a refused confirm as PHOTO_QUALITY', async () => {
    const server = uploadServer()
    const fetch: Fetch = async (input, init) =>
      new URL(String(input)).pathname === '/rest/v1/rpc/confirm_photo'
        ? json(400, { code: 'P0001', message: 'MEOOFY:PHOTO_QUALITY' })
        : server.fetch(input, init)

    await expect(uploadPhoto(stubClient(fetch), args)).rejects.toMatchObject({
      name: 'AppError',
      code: 'PHOTO_QUALITY',
    })
  })
})

describe('isPhotoLimitReached', () => {
  /** A server that refuses the upload slot with `body`, as PostgREST relays a raised exception. */
  const refusingSlot =
    (body: object): Fetch =>
    async (input) =>
      new URL(String(input)).pathname === '/rest/v1/rpc/request_photo_upload'
        ? json(400, body)
        : json(200, [])

  const refusal = (details: string | null) =>
    uploadPhoto(
      stubClient(
        refusingSlot({ code: 'P0001', message: 'MEOOFY:VALIDATION', details, hint: null }),
      ),
      args,
    ).catch((e: unknown) => e)

  it('recognises the server refusing a slot because the pet has as many photos as it may keep', async () => {
    const error = await refusal(`a pet can have at most ${LIMITS.photosPerPet} photos`)

    expect(error).toMatchObject({ name: 'AppError', code: 'VALIDATION', retryable: false })
    expect(isPhotoLimitReached(error)).toBe(true)
  })

  it.each([
    ['an id that is already used (Ruling 26)', 'id is already used by another photo'],
    ['a refusal with no detail', null],
  ])('is false for any other refused slot: %s', async (_label, details) => {
    const error = await refusal(details)

    expect(error).toMatchObject({ name: 'AppError', code: 'VALIDATION' })
    expect(isPhotoLimitReached(error)).toBe(false)
  })

  it('is false for anything that is not a VALIDATION refusal', () => {
    const detail = { details: `a pet can have at most ${LIMITS.photosPerPet} photos` }
    expect(isPhotoLimitReached(new AppError('UNKNOWN', 'boom', { cause: detail }))).toBe(false)
    expect(isPhotoLimitReached(new AppError('VALIDATION'))).toBe(false)
    expect(isPhotoLimitReached(detail)).toBe(false)
    expect(isPhotoLimitReached(null)).toBe(false)
    expect(isPhotoLimitReached('a pet can have at most 6 photos')).toBe(false)
  })
})

describe('listPhotos', () => {
  const pendingRow = {
    ...readyRow,
    id: PHOTO.replace('7a', '8a'),
    view: 'side',
    status: 'pending',
    width: null,
    height: null,
    storage_path: `${OWNER}/${PET}/${PHOTO.replace('7a', '8a')}.jpg`,
  }

  it('signs ready photos only, in one request, for LIMITS.signedUrlSeconds', async () => {
    const calls: Call[] = []
    const fetch: Fetch = async (input, init) => {
      const url = new URL(String(input))
      calls.push({ path: url.pathname + url.search, init })
      if (url.pathname === '/rest/v1/pet_photos') return json(200, [readyRow, pendingRow])
      if (url.pathname === '/storage/v1/object/sign/pet-photos') {
        return json(200, [
          { path: PATH, error: null, signedURL: `/object/sign/pet-photos/${PATH}?token=t` },
        ])
      }
      throw new Error(`unexpected request to ${url}`)
    }

    const photos = await listPhotos(stubClient(fetch), PET)

    expect(photos).toEqual([
      {
        id: PHOTO,
        petId: PET,
        view: 'front',
        status: 'ready',
        width: 1600,
        height: 1200,
        signedUrl: `http://stub.test/storage/v1/object/sign/pet-photos/${PATH}?token=t`,
      },
      {
        id: pendingRow.id,
        petId: PET,
        view: 'side',
        status: 'pending',
        width: 0,
        height: 0,
        signedUrl: null,
      },
    ])
    const select = new URL(`http://x${calls[0]!.path}`)
    expect(select.searchParams.get('pet_id')).toBe(`eq.${PET}`)
    expect(select.searchParams.get('order')).toBe('created_at.asc,id.asc')
    expect(calls).toHaveLength(2)
    expect(bodyOf(calls[1])).toEqual({ expiresIn: LIMITS.signedUrlSeconds, paths: [PATH] })
  })

  it('makes no storage request when no photo is ready', async () => {
    const fetch = vi.fn(async () => json(200, [pendingRow]))
    expect(await listPhotos(stubClient(fetch), PET)).toHaveLength(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('a ready photo storage could not sign has a null URL instead of failing the list', async () => {
    const fetch: Fetch = async (input) =>
      new URL(String(input)).pathname === '/rest/v1/pet_photos'
        ? json(200, [readyRow])
        : json(200, [{ path: PATH, error: 'Either the object does not exist', signedURL: null }])
    const [photo] = await listPhotos(stubClient(fetch), PET)
    expect(photo).toMatchObject({ id: PHOTO, status: 'ready', signedUrl: null })
  })

  it('rejects a pet id that is not a uuid as VALIDATION without a request', async () => {
    const fetch = vi.fn(offline)
    await expect(listPhotos(stubClient(fetch), 'pet-1')).rejects.toMatchObject({
      name: 'AppError',
      code: 'VALIDATION',
    })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('deletePhoto', () => {
  it('calls delete_photo with the id', async () => {
    const fetch = vi.fn<Fetch>(async () => new Response(null, { status: 204 }))
    await expect(deletePhoto(stubClient(fetch), PHOTO)).resolves.toBeUndefined()
    expect(new URL(String(fetch.mock.calls[0]![0])).pathname).toBe('/rest/v1/rpc/delete_photo')
  })

  it('resolves when the server answers NOT_OWNER (already gone, as deletePet does)', async () => {
    const fetch = async () => json(400, { code: 'P0001', message: 'MEOOFY:NOT_OWNER' })
    await expect(deletePhoto(stubClient(fetch), PHOTO)).resolves.toBeUndefined()
  })

  it('rejects an id that is not a uuid as VALIDATION without a request', async () => {
    const fetch = vi.fn(offline)
    await expect(deletePhoto(stubClient(fetch), 'photo-1')).rejects.toMatchObject({
      name: 'AppError',
      code: 'VALIDATION',
    })
    expect(fetch).not.toHaveBeenCalled()
  })
})
