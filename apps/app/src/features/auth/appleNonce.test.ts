import * as Crypto from 'expo-crypto'

import { createNonce } from './appleNonce'

// jest-expo stubs the native crypto module (random bytes come back as zeros and
// digests as nothing), so expo-crypto is replaced by Node's crypto behind the
// same API. This checks how createNonce uses the module; the native
// implementation itself runs on a device or in the browser.
jest.mock('expo-crypto', () => {
  const { createHash, randomBytes } = jest.requireActual('node:crypto')
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    CryptoEncoding: { HEX: 'hex', BASE64: 'base64' },
    getRandomBytesAsync: jest.fn(async (count: number) => new Uint8Array(randomBytes(count))),
    digestStringAsync: jest.fn(
      async (algorithm: string, data: string, options?: { encoding?: 'hex' | 'base64' }) => {
        if (algorithm !== 'SHA-256') throw new Error(`unexpected algorithm ${algorithm}`)
        return createHash('sha256')
          .update(data)
          .digest(options?.encoding ?? 'hex')
      },
    ),
  }
})

describe('createNonce', () => {
  it('hashes the raw nonce to 64 hex characters', async () => {
    const { hashed } = await createNonce()

    expect(hashed).toMatch(/^[0-9a-f]{64}$/)
  })

  it('makes the hash the SHA-256 of the raw nonce, which Apple gets and Supabase checks', async () => {
    // 32 bytes of 0xab give the raw nonce "ab" x 32; the digest below is its SHA-256
    // (printf 'abab...ab' | shasum -a 256), so the expectation does not depend on the code under test.
    jest.mocked(Crypto.getRandomBytesAsync).mockResolvedValueOnce(new Uint8Array(32).fill(0xab))

    const { raw, hashed } = await createNonce()

    expect(raw).toBe('ab'.repeat(32))
    expect(hashed).toBe('271a413bd339c5709fdceaec41f14f11e9fbfb5042d72d331c65f32b284cd09a')
  })

  it('differs between calls', async () => {
    const first = await createNonce()
    const second = await createNonce()

    expect(second.hashed).not.toBe(first.hashed)
    expect(second.raw).not.toBe(first.raw)
  })

  it('keeps the raw nonce long enough to be unguessable and safe to put in a request', async () => {
    const { raw } = await createNonce()

    expect(raw).toMatch(/^[0-9a-f]{64}$/)
  })
})
