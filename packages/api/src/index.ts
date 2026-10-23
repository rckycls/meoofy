// @pawpin/api: the only place the app talks to Supabase. Every exported function rejects with
// the core AppError only; raw Supabase errors never escape.
export {
  createPawpinClient,
  type PawpinClient,
  type PawpinClientOptions,
  type SessionStorage,
} from './client'
export { normalizeSupabaseError } from './errors'
export type { Entitlement, Profile } from './types'
export {
  deleteAccount,
  sendEmailCode,
  signInWithAppleIdToken,
  signOut,
  verifyEmailCode,
} from './auth'
export { completeOnboarding, getProfile, updateDisplayName } from './profile'
export { getEntitlement } from './entitlements'
