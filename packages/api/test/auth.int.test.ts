import { AppError } from '@meoofy/core'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createMeoofyClient,
  deleteAccount,
  getProfile,
  sendEmailCode,
  signInWithAppleIdToken,
  signOut,
  verifyEmailCode,
} from '../src'
import {
  admin,
  allowlist,
  anonClient,
  cleanup,
  clientWithAccessToken,
  latestEmailCode,
  newOwner,
  SUPABASE_URL,
  ANON_KEY,
  track,
  uniqueEmail,
} from './helpers'

afterAll(cleanup)

describe('email code sign-in', () => {
  it('signs in an allowlisted user with the emailed code; a wrong code is UNAUTHENTICATED', async () => {
    const email = await allowlist(uniqueEmail('code'))
    const client = anonClient()

    await sendEmailCode(client, email)
    const code = await latestEmailCode(email)
    const wrong = code === '000000' ? '111111' : '000000'

    await expect(verifyEmailCode(client, email, wrong)).rejects.toMatchObject({
      name: 'AppError',
      code: 'UNAUTHENTICATED',
    })

    await verifyEmailCode(client, email, code)
    const { data } = await client.auth.getSession()
    expect(data.session?.user.email).toBe(email)
    const profile = await getProfile(client)
    expect(profile.id).toBe(data.session?.user.id)
  })

  it('signs in the same way from the web client, which reads the URL and so uses PKCE', async () => {
    const email = await allowlist(uniqueEmail('web'))
    const client = createMeoofyClient({
      url: SUPABASE_URL,
      anonKey: ANON_KEY,
      detectSessionInUrl: true,
    })

    await sendEmailCode(client, email)
    await verifyEmailCode(client, email, await latestEmailCode(email))

    const { data } = await client.auth.getSession()
    expect(data.session?.user.email).toBe(email)
    expect((await getProfile(client)).id).toBe(data.session?.user.id)
  })

  it('refuses a stranger as INVITE_ONLY', async () => {
    const stranger = track('stranger@meoofy.test')
    const client = anonClient()

    const attempt = async () => {
      await sendEmailCode(client, stranger)
      await verifyEmailCode(client, stranger, '000000')
    }

    await expect(attempt()).rejects.toMatchObject({ name: 'AppError', code: 'INVITE_ONLY' })
    const { data } = await client.auth.getSession()
    expect(data.session).toBeNull()
  })
})

describe('Apple sign-in', () => {
  it('rejects an invalid id token with an AppError, never a raw Supabase error', async () => {
    const error = await signInWithAppleIdToken(anonClient(), 'not-a-jwt', 'nonce').catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(AppError)
  })
})

describe('signOut', () => {
  it('ends the session, after which reads are UNAUTHENTICATED', async () => {
    const { client } = await newOwner()

    await signOut(client)

    const { data } = await client.auth.getSession()
    expect(data.session).toBeNull()
    await expect(getProfile(client)).rejects.toMatchObject({
      name: 'AppError',
      code: 'UNAUTHENTICATED',
    })
  })
})

describe('deleteAccount', () => {
  it('deletes the user and forgets the session; a retry is UNAUTHENTICATED', async () => {
    const { client, userId } = await newOwner()
    const { data: before } = await client.auth.getSession()
    const staleToken = before.session?.access_token
    expect(staleToken).toBeDefined()

    await deleteAccount(client)

    const { data, error } = await admin.auth.admin.getUserById(userId)
    expect(data.user).toBeNull()
    expect(error?.status).toBe(404)
    const { data: after } = await client.auth.getSession()
    expect(after.session).toBeNull()

    // A retry with the old, still unexpired token (say the first response was lost): the user is
    // gone, so the function answers 401 and that is UNAUTHENTICATED (Ruling 25).
    await expect(deleteAccount(clientWithAccessToken(staleToken!))).rejects.toMatchObject({
      name: 'AppError',
      code: 'UNAUTHENTICATED',
    })
  })
})
