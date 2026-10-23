// Every exported function rejects with an AppError only, whatever supabase-js hands back.
import { AppError, type OnboardingPath } from '@pawpin/core'
import { describe, expect, it, vi } from 'vitest'
import {
  completeOnboarding,
  createPet,
  deleteAccount,
  deletePet,
  deletePhoto,
  getEntitlement,
  getPet,
  getProfile,
  listPets,
  listPhotos,
  sendEmailCode,
  signInWithAppleIdToken,
  signOut,
  updateDisplayName,
  updatePet,
  uploadPhoto,
  verifyEmailCode,
  type PawpinClient,
} from './index'
import { offline, respond, stubClient } from './testSupport'

const PET = '6f1c1d4e-1111-4222-8333-944455556666'
const PHOTO = '7a2b3c4d-5555-4666-8777-988899990000'

const calls: [string, (c: PawpinClient) => Promise<unknown>][] = [
  ['sendEmailCode', (c) => sendEmailCode(c, 'a@pawpin.test')],
  ['verifyEmailCode', (c) => verifyEmailCode(c, 'a@pawpin.test', '123456')],
  ['signInWithAppleIdToken', (c) => signInWithAppleIdToken(c, 'id-token', 'nonce')],
  ['deleteAccount', (c) => deleteAccount(c)],
  ['getProfile', (c) => getProfile(c)],
  ['completeOnboarding', (c) => completeOnboarding(c, 'owner')],
  ['updateDisplayName', (c) => updateDisplayName(c, 'Alex')],
  ['getEntitlement', (c) => getEntitlement(c)],
  ['listPets', (c) => listPets(c)],
  ['getPet', (c) => getPet(c, PET)],
  [
    'createPet',
    (c) => createPet(c, { id: PET, name: 'Rex', species: 'dog', breed: null, ageMonths: null }),
  ],
  ['updatePet', (c) => updatePet(c, PET, { name: 'Rex' })],
  ['deletePet', (c) => deletePet(c, PET)],
  ['listPhotos', (c) => listPhotos(c, PET)],
  [
    'uploadPhoto',
    (c) =>
      uploadPhoto(c, {
        id: PHOTO,
        petId: PET,
        view: 'front',
        jpeg: new ArrayBuffer(1024),
        width: 1600,
        height: 1200,
        blurScore: 300,
        brightness: 128,
      }),
  ],
  ['deletePhoto', (c) => deletePhoto(c, PHOTO)],
]

describe('network failures reject with a retryable NETWORK AppError', () => {
  it.each(calls)('%s', async (_name, call) => {
    const error = await call(stubClient(offline)).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AppError)
    expect(error).toMatchObject({ code: 'NETWORK', retryable: true })
  })
})

describe('server errors reject with the AppError the server named', () => {
  it.each(calls)('%s', async (_name, call) => {
    // Auth, PostgREST and the Edge Function all put the message somewhere different; each
    // function must find PAWPIN:RATE_LIMITED in its own service's answer.
    const body = {
      code: 'P0001',
      message: 'PAWPIN:RATE_LIMITED',
      msg: 'PAWPIN:RATE_LIMITED',
      error: 'PAWPIN:RATE_LIMITED',
    }
    const error = await call(stubClient(respond(400, body))).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AppError)
    expect(error).toMatchObject({ code: 'RATE_LIMITED' })
  })
})

describe('validation happens before any request', () => {
  it.each([
    ['empty', ''],
    ['whitespace only', '  \t '],
    ['41 characters', 'a'.repeat(41)],
  ])('updateDisplayName rejects a %s name as VALIDATION', async (_label, name) => {
    const fetch = vi.fn(offline)
    await expect(updateDisplayName(stubClient(fetch), name)).rejects.toMatchObject({
      name: 'AppError',
      code: 'VALIDATION',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('updateDisplayName sends the trimmed name', async () => {
    const fetch = vi.fn(respond(204))
    await updateDisplayName(stubClient(fetch), '  Alex ')
    const [url, init] = fetch.mock.calls[0]!
    expect(String(url)).toBe('http://stub.test/rest/v1/rpc/update_profile')
    expect(JSON.parse(String(init?.body))).toEqual({ display_name: 'Alex' })
  })

  it('completeOnboarding rejects an unknown path as VALIDATION', async () => {
    const fetch = vi.fn(offline)
    await expect(
      completeOnboarding(stubClient(fetch), 'walker' as OnboardingPath),
    ).rejects.toMatchObject({ name: 'AppError', code: 'VALIDATION' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('reads', () => {
  it('getProfile maps the api.my_profile row to camelCase', async () => {
    const row = {
      id: '6f1c1d4e-1111-4222-8333-944455556666',
      display_name: 'Alex',
      onboarding_path: 'finder',
      onboarding_completed_at: '2026-10-23T09:00:00+00:00',
    }
    expect(await getProfile(stubClient(respond(200, [row])))).toEqual({
      id: row.id,
      displayName: 'Alex',
      onboardingPath: 'finder',
      onboardingCompletedAt: '2026-10-23T09:00:00+00:00',
    })
  })

  it('getProfile with no row for the caller is UNAUTHENTICATED', async () => {
    await expect(getProfile(stubClient(respond(200, [])))).rejects.toMatchObject({
      name: 'AppError',
      code: 'UNAUTHENTICATED',
    })
  })

  it('getEntitlement maps the api.my_entitlement row, with no limit for max', async () => {
    const row = { tier: 'max', pet_limit: null, active_pets: 7 }
    expect(await getEntitlement(stubClient(respond(200, [row])))).toEqual({
      tier: 'max',
      petLimit: null,
      activePets: 7,
    })
  })

  it('getEntitlement with no row for the caller is UNAUTHENTICATED', async () => {
    await expect(getEntitlement(stubClient(respond(200, [])))).rejects.toMatchObject({
      name: 'AppError',
      code: 'UNAUTHENTICATED',
    })
  })
})

describe('deleteAccount', () => {
  it('maps the function 401 body to UNAUTHENTICATED', async () => {
    const fetch = respond(401, { error: 'PAWPIN:UNAUTHENTICATED' })
    await expect(deleteAccount(stubClient(fetch))).rejects.toMatchObject({
      name: 'AppError',
      code: 'UNAUTHENTICATED',
    })
  })

  it('posts to delete-account and resolves on 204', async () => {
    const fetch = vi.fn(respond(204))
    await expect(deleteAccount(stubClient(fetch))).resolves.toBeUndefined()
    const [url, init] = fetch.mock.calls[0]!
    expect(String(url)).toBe('http://stub.test/functions/v1/delete-account')
    expect(init?.method).toBe('POST')
  })
})

describe('signOut', () => {
  it('resolves without a session (nothing to revoke)', async () => {
    const fetch = vi.fn(offline)
    await expect(signOut(stubClient(fetch))).resolves.toBeUndefined()
  })
})
