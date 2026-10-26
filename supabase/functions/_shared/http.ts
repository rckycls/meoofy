/** Small HTTP helpers shared by the Edge Function handlers. */

/** The token of an `Authorization: Bearer <token>` header, or null when there is none. */
export function bearerToken(req: Request): string | null {
  const match = /^Bearer[ ]+(\S+)[ ]*$/i.exec(req.headers.get('authorization') ?? '')
  return match?.[1] ?? null
}

/** A JSON response. */
export function json(status: number, body: unknown, headers: HeadersInit = {}): Response {
  const res = new Response(JSON.stringify(body), { status, headers })
  res.headers.set('content-type', 'application/json')
  return res
}

/** The error body the app parses: `{"error":"MEOOFY:<CODE>"}` (see packages/core errors.ts). */
export function appError(status: number, code: string, headers: HeadersInit = {}): Response {
  return json(status, { error: `MEOOFY:${code}` }, headers)
}

/**
 * Compares two secrets in time that doesn't depend on where they first differ. An empty
 * expected secret never matches, so a missing configuration value can't be "guessed" as ''.
 */
export function sameSecret(given: string, expected: string): boolean {
  if (expected.length === 0) return false
  const a = new TextEncoder().encode(given)
  const b = new TextEncoder().encode(expected)
  let diff = a.length ^ b.length
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}
