import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  completeOnboarding,
  getEntitlement,
  getProfile,
  updateDisplayName,
  type PawpinClient,
} from '../src'
import { admin, cleanup, clientWithAccessToken, newOwner, signAccessToken } from './helpers'

afterAll(cleanup)

describe('profile and entitlement of a new owner', () => {
  let client: PawpinClient
  let userId: string

  beforeAll(async () => {
    ;({ client, userId } = await newOwner())
  })

  it('starts with an empty name and no onboarding', async () => {
    expect(await getProfile(client)).toEqual({
      id: userId,
      displayName: '',
      onboardingPath: null,
      onboardingCompletedAt: null,
    })
  })

  it('updateDisplayName trims the name', async () => {
    await updateDisplayName(client, '  Alex ')
    expect((await getProfile(client)).displayName).toBe('Alex')
  })

  it('updateDisplayName rejects an empty name as VALIDATION without a network call', async () => {
    const rpc = vi.spyOn(client, 'rpc')
    try {
      await expect(updateDisplayName(client, '')).rejects.toMatchObject({
        name: 'AppError',
        code: 'VALIDATION',
      })
      expect(rpc).not.toHaveBeenCalled()
    } finally {
      rpc.mockRestore()
    }
  })

  it('completeOnboarding records the path once', async () => {
    await completeOnboarding(client, 'owner')
    const first = await getProfile(client)
    expect(first.onboardingPath).toBe('owner')
    expect(first.onboardingCompletedAt).not.toBeNull()

    await completeOnboarding(client, 'finder')
    expect(await getProfile(client)).toEqual(first)
  })

  it('getEntitlement returns the free tier with no pets', async () => {
    expect(await getEntitlement(client)).toEqual({ tier: 'free', petLimit: 3, activePets: 0 })
  })
})

describe('sessions that are no longer valid', () => {
  it('expired session maps to UNAUTHENTICATED', async () => {
    const { userId } = await newOwner()

    // Control: the same claims with a future expiry are accepted, so only the expiry differs.
    const live = clientWithAccessToken(await signAccessToken(userId, 600))
    expect((await getProfile(live)).id).toBe(userId)

    const expired = clientWithAccessToken(await signAccessToken(userId, -3600))
    await expect(getProfile(expired)).rejects.toMatchObject({
      name: 'AppError',
      code: 'UNAUTHENTICATED',
    })
    await expect(getEntitlement(expired)).rejects.toMatchObject({
      name: 'AppError',
      code: 'UNAUTHENTICATED',
    })
  })

  it('a deleted user with a still-valid token is UNAUTHENTICATED', async () => {
    const { client, userId } = await newOwner()
    const { error } = await admin.auth.admin.deleteUser(userId)
    expect(error).toBeNull()

    await expect(getProfile(client)).rejects.toMatchObject({
      name: 'AppError',
      code: 'UNAUTHENTICATED',
    })
    await expect(getEntitlement(client)).rejects.toMatchObject({
      name: 'AppError',
      code: 'UNAUTHENTICATED',
    })
    await expect(updateDisplayName(client, 'Alex')).rejects.toMatchObject({
      name: 'AppError',
      code: 'UNAUTHENTICATED',
    })
  })
})
