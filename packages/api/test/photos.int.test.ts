import { randomUUID } from 'node:crypto'
import { LIMITS, type PhotoView } from '@pawpin/core'
import { decodeJwt } from 'jose'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createPet,
  deletePet,
  deletePhoto,
  isPhotoLimitReached,
  listPhotos,
  uploadPhoto,
  type PawpinClient,
  type PetPhoto,
} from '../src'
import { cleanup, makeTestJpeg, newOwner, queuedPaths, sql } from './helpers'

afterAll(cleanup)

/** A signed-in owner with one pet. */
async function ownerWithPet(): Promise<{ client: PawpinClient; userId: string; petId: string }> {
  const { client, userId } = await newOwner()
  const { id: petId } = await createPet(client, {
    id: randomUUID(),
    name: 'Biscuit',
    species: 'dog',
    breed: null,
    ageMonths: null,
  })
  return { client, userId, petId }
}

/** uploadPhoto's arguments for a 1600×1200 test photo; metrics as the device would measure. */
function photoUpload(petId: string, view: PhotoView, seed = 1) {
  return {
    id: randomUUID(),
    petId,
    view,
    jpeg: makeTestJpeg(1600, 1200, seed),
    width: 1600,
    height: 1200,
    blurScore: 3991,
    brightness: 128,
  }
}

describe('uploading a reference photo', () => {
  it('a 1600×1200 JPEG becomes one ready front photo whose signed URL serves it', async () => {
    const { client, petId } = await ownerWithPet()
    const upload = photoUpload(petId, 'front')

    const photo = await uploadPhoto(client, upload)
    expect(photo).toEqual<PetPhoto>({
      id: upload.id,
      petId,
      view: 'front',
      status: 'ready',
      width: 1600,
      height: 1200,
      signedUrl: expect.any(String),
    })

    const photos = await listPhotos(client, petId)
    expect(photos).toEqual([{ ...photo, signedUrl: expect.any(String) }])

    const signedUrl = photos[0]!.signedUrl!
    const response = await fetch(signedUrl)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(Buffer.from(await response.arrayBuffer()).equals(Buffer.from(upload.jpeg))).toBe(true)

    // The URL is good for LIMITS.signedUrlSeconds (one hour) and no longer.
    const token = decodeJwt(new URL(signedUrl).searchParams.get('token')!)
    expect(token.exp! - token.iat!).toBe(LIMITS.signedUrlSeconds)
  })

  it('a second front photo replaces the first, leaving one front photo', async () => {
    const { client, userId, petId } = await ownerWithPet()
    const first = await uploadPhoto(client, photoUpload(petId, 'front', 1))
    const second = await uploadPhoto(client, photoUpload(petId, 'front', 2))

    const fronts = (await listPhotos(client, petId)).filter((p) => p.view === 'front')
    expect(fronts).toHaveLength(1)
    expect(fronts[0]).toMatchObject({ id: second.id, status: 'ready' })
    expect(fronts[0]!.id).not.toBe(first.id)
    // The replaced file is queued for the cleanup job, not left behind.
    expect(await queuedPaths(userId, petId)).toBe(1)
  })

  it('a photo the server finds too small is PHOTO_QUALITY and stays pending (retryable)', async () => {
    const { client, petId } = await ownerWithPet()
    const upload = photoUpload(petId, 'front')

    await expect(uploadPhoto(client, { ...upload, height: 600 })).rejects.toMatchObject({
      name: 'AppError',
      code: 'PHOTO_QUALITY',
    })
    expect(await listPhotos(client, petId)).toEqual<PetPhoto[]>([
      {
        id: upload.id,
        petId,
        view: 'front',
        status: 'pending',
        width: 0,
        height: 0,
        signedUrl: null,
      },
    ])

    // The same photo retried (its file is already uploaded) is confirmed.
    const retried = await uploadPhoto(client, upload)
    expect(retried).toMatchObject({ id: upload.id, status: 'ready', height: 1200 })
    expect(await listPhotos(client, petId)).toEqual([retried])
  })

  it('retrying an upload that already went through returns the same photo', async () => {
    const { client, petId } = await ownerWithPet()
    const upload = photoUpload(petId, 'front')
    const first = await uploadPhoto(client, upload)

    const retried = await uploadPhoto(client, upload)

    expect(retried).toEqual({ ...first, signedUrl: expect.any(String) })
    expect(await listPhotos(client, petId)).toHaveLength(1)
  })

  it('deletePhoto removes the photo and queues its file; a second delete resolves', async () => {
    const { client, userId, petId } = await ownerWithPet()
    const photo = await uploadPhoto(client, photoUpload(petId, 'side'))

    await deletePhoto(client, photo.id)

    expect(await listPhotos(client, petId)).toEqual([])
    expect(await queuedPaths(userId, petId)).toBe(1)
    await expect(deletePhoto(client, photo.id)).resolves.toBeUndefined()
    expect(await queuedPaths(userId, petId)).toBe(1)
  })

  it("owner B can neither see nor add to owner A's photos", async () => {
    const a = await ownerWithPet()
    const b = await newOwner()
    await uploadPhoto(a.client, photoUpload(a.petId, 'front'))

    expect(await listPhotos(b.client, a.petId)).toEqual([])
    await expect(uploadPhoto(b.client, photoUpload(a.petId, 'side'))).rejects.toMatchObject({
      name: 'AppError',
      code: 'NOT_OWNER',
    })
    expect(await listPhotos(a.client, a.petId)).toHaveLength(1)
  })
})

describe('refused and replaced upload slots', () => {
  it('a new photo for a view replaces the photo left pending there, and queues its file', async () => {
    const { client, userId, petId } = await ownerWithPet()
    await expect(
      uploadPhoto(client, { ...photoUpload(petId, 'front', 1), height: 600 }),
    ).rejects.toMatchObject({ code: 'PHOTO_QUALITY' })

    const second = await uploadPhoto(client, photoUpload(petId, 'front', 2))

    expect(await listPhotos(client, petId)).toEqual([{ ...second, signedUrl: expect.any(String) }])
    expect(await queuedPaths(userId, petId)).toBe(1)
  })

  it("a deleted photo's id is refused (VALIDATION) until cleanup has removed its file", async () => {
    const { client, petId } = await ownerWithPet()
    const upload = photoUpload(petId, 'side')
    const photo = await uploadPhoto(client, upload)
    await deletePhoto(client, photo.id)

    const error = await uploadPhoto(client, upload).catch((e: unknown) => e)

    expect(error).toMatchObject({ name: 'AppError', code: 'VALIDATION', retryable: false })
    expect(isPhotoLimitReached(error)).toBe(false)
    expect(await listPhotos(client, petId)).toEqual([])
  })

  it('a pet with as many photos as it may keep refuses a new one, and the app can tell why', async () => {
    const { client, userId, petId } = await ownerWithPet()
    // Ready extra photos, written as postgres: through the API a pet holds one pending photo per
    // view at most, so only ready photos fill it up.
    await sql(
      `insert into registry.pet_photos
         (id, pet_id, owner_id, view, storage_path, bytes, status, width, height, confirmed_at)
       select gen_random_uuid(), $1::uuid, $2::uuid, 'extra',
              $2::text || '/' || $1::text || '/' || gen_random_uuid() || '.jpg',
              1000, 'ready', 1600, 1200, now()
         from generate_series(1, $3::int)`,
      [petId, userId, LIMITS.photosPerPet],
    )

    const error = await uploadPhoto(client, photoUpload(petId, 'front')).catch((e: unknown) => e)

    expect(error).toMatchObject({ name: 'AppError', code: 'VALIDATION', retryable: false })
    expect(isPhotoLimitReached(error)).toBe(true)
  })
})

describe('deleting a pet with photos', () => {
  it("queues one path per photo of the pet, whatever the photo's status", async () => {
    const { client, userId, petId } = await ownerWithPet()
    await uploadPhoto(client, photoUpload(petId, 'front'))
    await uploadPhoto(client, photoUpload(petId, 'side'))
    // A third photo left pending by a refused confirm.
    await expect(
      uploadPhoto(client, { ...photoUpload(petId, 'markings'), width: 700, height: 500 }),
    ).rejects.toMatchObject({ code: 'PHOTO_QUALITY' })

    const photos = await listPhotos(client, petId)
    expect(photos.map((p) => p.status).sort()).toEqual(['pending', 'ready', 'ready'])
    const before = await queuedPaths(userId, petId)

    await deletePet(client, petId)

    expect(await queuedPaths(userId, petId)).toBe(before + photos.length)
    expect(await listPhotos(client, petId)).toEqual([])
  })
})
