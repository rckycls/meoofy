import { env, readEnv } from './env'

const base = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon',
}

describe('readEnv', () => {
  it('reads the Supabase settings and keeps Report missing off', () => {
    expect(readEnv(base)).toEqual({
      supabaseUrl: 'https://abc.supabase.co',
      supabaseAnonKey: 'anon',
      sentryDsn: null,
      supportEmail: null,
      e2e: false,
      flags: { reportMissing: false },
    })
  })

  it('reads the Sentry DSN, treating an empty one as unset', () => {
    expect(
      readEnv({ ...base, EXPO_PUBLIC_SENTRY_DSN: 'https://k@o1.ingest.sentry.io/2' }).sentryDsn,
    ).toBe('https://k@o1.ingest.sentry.io/2')
    expect(readEnv({ ...base, EXPO_PUBLIC_SENTRY_DSN: ' ' }).sentryDsn).toBeNull()
  })

  it('reads the support address, treating an empty one as unset', () => {
    expect(
      readEnv({ ...base, EXPO_PUBLIC_SUPPORT_EMAIL: ' help@meoofy.example ' }).supportEmail,
    ).toBe('help@meoofy.example')
    expect(readEnv({ ...base, EXPO_PUBLIC_SUPPORT_EMAIL: ' ' }).supportEmail).toBeNull()
    expect(readEnv(base).supportEmail).toBeNull()
  })

  it('keeps the support address only when it is a plain address, so a mailto: link cannot carry more', () => {
    for (const bad of [
      'help me@meoofy.example',
      'help@meoofy.example?subject=hi',
      'help@meoofy.example&cc=other@meoofy.example',
      'help@meoofy.example,other@meoofy.example',
      'mailto:help@meoofy.example',
      'help@meoofy',
      'not an address',
      '@meoofy.example',
    ]) {
      expect(readEnv({ ...base, EXPO_PUBLIC_SUPPORT_EMAIL: bad }).supportEmail).toBeNull()
    }
    expect(
      readEnv({ ...base, EXPO_PUBLIC_SUPPORT_EMAIL: 'help+pilot@meoofy.example' }).supportEmail,
    ).toBe('help+pilot@meoofy.example')
  })

  it("turns the end-to-end seams on only for '1'", () => {
    expect(readEnv({ ...base, EXPO_PUBLIC_E2E: '1' }).e2e).toBe(true)
    expect(readEnv({ ...base, EXPO_PUBLIC_E2E: 'true' }).e2e).toBe(false)
    expect(readEnv({ ...base, EXPO_PUBLIC_E2E: '0' }).e2e).toBe(false)
  })

  it('names the missing variable', () => {
    expect(() => readEnv({ EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon' })).toThrow(
      /EXPO_PUBLIC_SUPABASE_URL/,
    )
    expect(() => readEnv({ ...base, EXPO_PUBLIC_SUPABASE_ANON_KEY: '' })).toThrow(
      /EXPO_PUBLIC_SUPABASE_ANON_KEY/,
    )
  })
})

describe('env', () => {
  it('comes from the EXPO_PUBLIC_ variables', () => {
    expect(env.supabaseUrl).toBe('http://127.0.0.1:54321')
    expect(env.supabaseAnonKey).toBe('test-anon-key')
    expect(env.flags.reportMissing).toBe(false)
  })
})
