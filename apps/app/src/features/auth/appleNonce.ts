import * as Crypto from 'expo-crypto'

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * A fresh nonce for one Sign in with Apple attempt. Apple puts `hashed` into the identity token
 * it signs; Supabase is given `raw` and hashes it to compare. A token minted for another attempt
 * (a replay) therefore does not verify.
 *
 * `raw` is 32 random bytes as hex; `hashed` is the SHA-256 of `raw` as hex (64 characters).
 */
export async function createNonce(): Promise<{ raw: string; hashed: string }> {
  const raw = toHex(await Crypto.getRandomBytesAsync(32))
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw, {
    encoding: Crypto.CryptoEncoding.HEX,
  })
  return { raw, hashed }
}
