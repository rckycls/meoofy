// The web build signs in with Apple through a redirect back to the app, so it must read the
// session from the URL it returns to; every other sign-in path must leave the URL alone. Reading
// the URL must not let a crafted link sign a person into someone else's account.
import { createClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createMeoofyClient,
  signInWithAppleWeb,
  type MeoofyClient,
  type SessionStorage,
} from './index'

const authSettings = (c: MeoofyClient) =>
  c.auth as unknown as { detectSessionInUrl: unknown; flowType: unknown }

const base = { url: 'http://stub.test', anonKey: 'stub-anon-key' }

/** A SessionStorage over a Map, so a test can see what the client keeps. */
function memoryStorage() {
  const items = new Map<string, string>()
  const storage: SessionStorage = {
    getItem: async (key) => items.get(key) ?? null,
    setItem: async (key, value) => void items.set(key, value),
    removeItem: async (key) => void items.delete(key),
  }
  return { storage, items }
}

describe('createMeoofyClient', () => {
  it('ignores the URL by default (email code and Apple id token sign-in never redirect back)', () => {
    const auth = authSettings(createMeoofyClient(base))
    expect(auth.detectSessionInUrl).toBe(false)
    expect(auth.flowType).toBe('implicit')
  })

  it('reads the session from the URL when asked to (the web Apple redirect), and only over PKCE', () => {
    const auth = authSettings(createMeoofyClient({ ...base, detectSessionInUrl: true }))
    expect(auth.detectSessionInUrl).toBe(true)
    expect(auth.flowType).toBe('pkce')
  })
})

describe('a page opened from a link, with reading the URL on', () => {
  afterEach(() => vi.unstubAllGlobals())

  const attackerLink =
    'https://app.meoofy.test/#access_token=attacker-access&refresh_token=attacker-refresh&expires_in=3600&token_type=bearer'

  /** A browser at `href`, and a server that would accept any token it is shown. */
  function openPage(href: string) {
    const requests: string[] = []
    vi.stubGlobal('document', {})
    vi.stubGlobal('window', {
      location: { href, hash: '' },
      history: { replaceState: vi.fn() },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      requests.push(String(input))
      return new Response(
        JSON.stringify({ id: 'attacker-id', aud: 'authenticated', email: 'attacker@example.com' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    return requests
  }

  it('control: the default implicit flow does sign in from a fragment that carries tokens', async () => {
    openPage(attackerLink)
    const { storage } = memoryStorage()
    const client = createClient('http://stub.test', 'stub-anon-key', {
      auth: { storage, detectSessionInUrl: true, autoRefreshToken: false },
    })

    const { data } = await client.auth.getSession()

    expect(data.session?.access_token).toBe('attacker-access')
  })

  it('refuses a fragment that carries tokens: no request, no session, nothing stored', async () => {
    const requests = openPage(attackerLink)
    const { storage, items } = memoryStorage()
    const client = createMeoofyClient({ ...base, storage, detectSessionInUrl: true })

    const { data } = await client.auth.getSession()

    expect(data.session).toBeNull()
    expect(requests).toEqual([])
    expect(items.size).toBe(0)
  })

  it('leaves a signed-in person signed in when such a link is opened', async () => {
    const { storage, items } = memoryStorage()
    const session = {
      access_token: 'own-access',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'own-refresh',
      user: { id: 'own-id', aud: 'authenticated' },
    }
    items.set('sb-stub-auth-token', JSON.stringify(session))
    openPage(attackerLink)
    const client = createMeoofyClient({ ...base, storage, detectSessionInUrl: true })

    const { data } = await client.auth.getSession()

    expect(data.session?.access_token).toBe('own-access')
  })

  it('ignores a ?code= that this browser did not ask for (no verifier is stored)', async () => {
    const requests = openPage('https://app.meoofy.test/?code=attacker-code')
    const { storage } = memoryStorage()
    const client = createMeoofyClient({ ...base, storage, detectSessionInUrl: true })

    const { data } = await client.auth.getSession()

    expect(data.session).toBeNull()
    expect(requests).toEqual([])
  })
})

describe('signInWithAppleWeb on a client that reads the URL', () => {
  it('keeps a code verifier for the return trip and sends only its challenge to Apple', async () => {
    const { storage, items } = memoryStorage()
    const client = createMeoofyClient({ ...base, storage, detectSessionInUrl: true })
    const oauth = vi.spyOn(client.auth, 'signInWithOAuth')

    await signInWithAppleWeb(client)

    expect([...items.keys()].some((key) => key.includes('code-verifier'))).toBe(true)
    const { data } = await oauth.mock.results[0]!.value
    const authorize = new URL(data.url)
    expect(authorize.searchParams.get('provider')).toBe('apple')
    expect(authorize.searchParams.get('code_challenge')).toMatch(/\S{20,}/)
    expect(authorize.searchParams.get('code_challenge_method')).toBe('s256')
    // The verifier itself never leaves the browser.
    for (const [key, value] of items) {
      if (key.includes('code-verifier')) expect(authorize.href).not.toContain(value)
    }
  })
})
