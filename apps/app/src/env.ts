export type Env = {
  supabaseUrl: string
  supabaseAnonKey: string
  /** Sentry is off when unset. */
  sentryDsn: string | null
  /**
   * Where invite-only visitors can write to ask for an invite. The invite-only message shows a
   * `mailto:` link to it, and none when it is unset or not a plain address. Public by nature: it
   * ships in the bundle.
   */
  supportEmail: string | null
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
  EXPO_PUBLIC_SUPPORT_EMAIL?: string
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

/**
 * A plain address: no spaces and none of `?`, `&`, `,` or `;`, which would let a mailto: link
 * carry a subject, a copy or more than one recipient. Anything else is treated as unset.
 */
const SUPPORT_EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/

function supportEmail(value: string | undefined): string | null {
  const address = value?.trim()
  return address && SUPPORT_EMAIL.test(address) ? address : null
}

export function readEnv(source: EnvSource): Env {
  return {
    supabaseUrl: required(source, 'EXPO_PUBLIC_SUPABASE_URL'),
    supabaseAnonKey: required(source, 'EXPO_PUBLIC_SUPABASE_ANON_KEY'),
    sentryDsn: source.EXPO_PUBLIC_SENTRY_DSN?.trim() || null,
    supportEmail: supportEmail(source.EXPO_PUBLIC_SUPPORT_EMAIL),
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
  EXPO_PUBLIC_SUPPORT_EMAIL: process.env.EXPO_PUBLIC_SUPPORT_EMAIL,
  EXPO_PUBLIC_E2E: process.env.EXPO_PUBLIC_E2E,
})
