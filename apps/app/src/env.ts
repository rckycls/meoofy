export type Env = {
  supabaseUrl: string
  supabaseAnonKey: string
  /** Sentry is off when unset. */
  sentryDsn: string | null
  /** End-to-end seams such as "Use test photo" (development builds only). */
  e2e: boolean
  flags: {
    /** "Report missing" ships in the recovery sub-project; this build never shows it. */
    reportMissing: false
  }
}

type EnvSource = {
  EXPO_PUBLIC_SUPABASE_URL?: string
  EXPO_PUBLIC_SUPABASE_ANON_KEY?: string
  EXPO_PUBLIC_SENTRY_DSN?: string
  EXPO_PUBLIC_E2E?: string
}

function required(
  source: EnvSource,
  name: 'EXPO_PUBLIC_SUPABASE_URL' | 'EXPO_PUBLIC_SUPABASE_ANON_KEY',
) {
  const value = source[name]?.trim()
  if (!value) {
    throw new Error(
      `${name} is not set. Copy apps/app/.env.example to apps/app/.env and fill it in.`,
    )
  }
  return value
}

export function readEnv(source: EnvSource): Env {
  return {
    supabaseUrl: required(source, 'EXPO_PUBLIC_SUPABASE_URL'),
    supabaseAnonKey: required(source, 'EXPO_PUBLIC_SUPABASE_ANON_KEY'),
    sentryDsn: source.EXPO_PUBLIC_SENTRY_DSN?.trim() || null,
    e2e: source.EXPO_PUBLIC_E2E === '1',
    flags: { reportMissing: false },
  }
}

// Expo inlines EXPO_PUBLIC_ variables into the bundle only where they are read
// as literal `process.env.EXPO_PUBLIC_…` member expressions, so each is named.
export const env: Env = readEnv({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
  EXPO_PUBLIC_E2E: process.env.EXPO_PUBLIC_E2E,
})
