# Meoofy App Foundation and Private Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a pilot-ready Expo app (iOS via TestFlight and web) where invited owners onboard, sign in with Apple or a 6-digit email code, and privately register up to three dogs or cats with reference photos on a Supabase backend that enforces ownership, limits and audit server-side.

**Architecture:** A pnpm monorepo. One Expo Router app (`apps/app`) depends on a design-system package (`packages/ui`) and a typed Supabase wrapper (`packages/api`), which depends on pure domain rules (`packages/core`). Supabase hosts Postgres. Each module has its own schema (`identity`, `registry`, `entitlements`, `audit`, `internal`). Clients get row-level-security reads only; every write goes through `api.*` security-definer functions or Edge Functions. Photos live in a private bucket behind signed URLs.

**Tech Stack:** Expo SDK 58 (Expo Router, expo-camera, expo-image-picker, expo-image-manipulator, expo-apple-authentication, expo-secure-store), React Native + react-native-web, Reanimated 4, react-native-svg + @svgr/cli, TanStack Query 5 (+ persist client), zod, jpeg-js, Supabase (Postgres 17, Auth, Storage, Edge Functions on Deno, pg_cron + pg_net), supabase-js 2, Vitest (core, api), Jest + jest-expo + React Native Testing Library (ui, app), pgTAP via `supabase test db`, Maestro (iOS end-to-end), Playwright (web end-to-end), Sentry (`@sentry/react-native`), EAS Build/Submit/Hosting.

**Spec:** `docs/superpowers/specs/2026-10-23-app-foundation-registry-design.md`. The parent product spec is `docs/product/meoofy-design-spec.md`. Executors read both.

## Global Constraints

- Repository root: `/Users/rockycelis/Documents/Codex/2026-10-23/i/meoofy`. Package manager is pnpm 11 with `node-linker=hoisted` in `.npmrc`. Node 24.x.
- Package names: `@meoofy/app`, `@meoofy/ui`, `@meoofy/api`, `@meoofy/core`. Dependencies run only `app → api → core` and `app → ui`. `core` has no internal dependencies.
- TypeScript `strict: true` everywhere. Pin exact versions (no `^`) for expo, react-native, supabase-js and the supabase CLI.
- Screens never import `@supabase/supabase-js`. Only `packages/api` may.
- Clients get **no** insert/update/delete policies or grants on any table. Writes happen only through `api.*` functions or Edge Functions.
- Server errors raise `MEOOFY:<CODE>`. Codes: `UNAUTHENTICATED`, `NOT_OWNER`, `VALIDATION`, `PET_LIMIT_REACHED`, `PHOTO_QUALITY`, `RATE_LIMITED`. Client-only codes: `INVITE_ONLY`, `NETWORK`, `UNKNOWN`.
- Limits, copied from the spec:
  - Pet name 1–40 characters; breed ≤ 80; `age_months` 0–360; age form years 0–30 plus months 0–11.
  - Display name 1–40.
  - Tiers: free 3, pro 10, max unlimited (`null`).
  - ≤ 6 non-rejected photos per pet; JPEG only; ≤ 4 194 304 bytes; short side ≥ 720 px.
  - Encode at 1600 px long edge, quality 0.8. Analysis on a 512 px grayscale copy: brightness 40–220, Laplacian-variance blur ≥ 80.
  - 30 upload requests per user per rolling hour. Signed URLs 3600 s. Pending photos older than 24 h are cleaned. Cleanup runs every 5 minutes.
- Character counts use Unicode code points (`[...s].length` in TypeScript, `char_length` in Postgres) after trimming.
- Audit `metadata` never contains names, emails, coordinates or storage paths.
- Copy is English, in one `copy.ts` per feature folder.
- Stickers are decorative: `accessibilityElementsHidden`, `importantForAccessibility="no-hide-descendants"`, `aria-hidden` on web. They never convey status.
- Reduce Motion: loops stop and entrances become a 160 ms opacity fade. Buttons respond from the first frame. Status, privacy and error text never animate.
- Tap targets ≥ 44 pt. Text and background pairs come only from the token roles (all AA-checked).
- Layout widths: < 768 px `mobile`; 768–1023 px `mobile-centered` (content max width 560); ≥ 1024 px `desktop` (two-column W06 layout, top nav instead of tab bar).
- iOS bundle identifier is `com.meoofy.pilot`. Task 25's setup wizard lets the owner change it before the first EAS build.
- Commits: Conventional Commits. Every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Double tap at the limit.** An owner with 2 pets taps "Save" twice quickly. Exactly one 3rd pet is created and the other request gets `PET_LIMIT_REACHED`. Tested in Task 11 (`concurrent creates never exceed the limit`).
2. **Emoji and whitespace names.** "   " is rejected. "🐶🐶" counts as 2 characters in both the client and Postgres, and exactly 40 emoji is accepted by both. Tested in Task 2 (`counts code points`) and Task 6 (`create_pet accepts 40 emoji`).
3. **Retaking a photo for the same view.** The profile shows one photo per view, and the replaced file is queued for deletion rather than leaked. Tested in Task 7 (`confirm_photo replaces same view`).
4. **Session ends mid-use.** A token is revoked or the account is deleted on another device. The next request maps to `UNAUTHENTICATED` and the app routes to sign-in without crashing. Tested in Task 10 (`expired session maps to UNAUTHENTICATED`) and Task 16 (`signed-out state routes to sign-in`).
5. **Offline cold start.** The app opens without a network after a previous session. The cached pets and offline banner show, and an unsent add-pet draft survives an app restart. Tested in Task 22 (`renders cached pets offline`, `restores draft after restart`).

---

## Before you start (one-time machine setup, owner action)

- [ ] Install Docker Desktop or OrbStack, start it, and confirm `docker info` succeeds. Local Supabase needs it.
- [ ] Install Deno (`brew install deno`) for Edge Function tests, and Maestro (`brew tap mobile-dev-inc/tap && brew install maestro`) for iOS end-to-end tests.
- [ ] Confirm the tools: `node -v` (24.x), `pnpm -v` (11.x), `xcrun simctl list runtimes` (an iOS 26 runtime).

## File Structure

```
meoofy/
├─ package.json  pnpm-workspace.yaml  .npmrc  tsconfig.base.json  eslint.config.js  .prettierrc
├─ tools/
│  ├─ stickers/stickers.py          (exists) sticker artwork source
│  ├─ stickers/export_svgs.py       writes packages/ui/assets/stickers/*.svg
│  ├─ tokens/figma-tokens.json      (exists) flattened Figma variables
│  ├─ tokens/build-tokens.ts        writes packages/ui/src/theme/tokens.ts
│  ├─ fixtures/make-photo-fixtures.ts  writes e2e/test JPEG fixtures
│  └─ setup/pilot-setup.sh          owner setup wizard (Task 25)
├─ packages/core/src/   limits.ts  tiers.ts  schemas.ts  age.ts  errors.ts  photoQuality.ts  sqlLimits.ts  index.ts
├─ packages/core/scripts/emit-sql-limits.ts
├─ packages/api/src/    client.ts  database.types.ts(generated)  types.ts  auth.ts  profile.ts  pets.ts  photos.ts  entitlements.ts  index.ts
├─ packages/api/test/   helpers.ts  *.int.test.ts
├─ packages/ui/src/theme/   tokens.ts(generated)  roles.ts  type.ts
├─ packages/ui/src/primitives/  Button.tsx Field.tsx Switch.tsx Checkbox.tsx Chip.tsx Card.tsx PrivacyBanner.tsx StepDots.tsx ScreenShell.tsx TabBar.tsx WebNav.tsx
├─ packages/ui/src/stickers/    generated/*.tsx  Sticker.tsx  names.ts  PetPortrait.tsx
├─ packages/ui/src/motion/      presets.ts  resolveMotion.ts  useMotionPreference.ts  Peel.tsx Float.tsx Twinkle.tsx Confetti.tsx
├─ supabase/config.toml
├─ supabase/migrations/  20261023000000_limits.sql (generated)  …01_schema.sql  …02_rls.sql  …03_audit.sql
│                        …04_profile_api.sql  …05_pet_api.sql  …06_photo_api.sql  …07_auth_hook.sql  …08_cleanup.sql
├─ supabase/tests/database/  000_helpers.sql  010_schema_rls.test.sql  020_profile.test.sql  030_pets.test.sql
│                            040_photos.test.sql  050_auth_hook.test.sql  060_cleanup.test.sql
├─ supabase/functions/_shared/  deleteAccount.ts  cleanup.ts  (+ *_test.ts)
├─ supabase/functions/delete-account/index.ts   supabase/functions/storage-cleanup/index.ts
└─ apps/app/
   ├─ app.config.ts  eas.json  jest.config.js  playwright.config.ts
   ├─ app/  (routes from spec §8)
   ├─ src/env.ts  src/navigation/entry.ts  src/layout/layoutMode.ts  src/storage/local.ts
   ├─ src/state/SessionProvider.tsx  src/state/QueryProvider.tsx
   ├─ src/data/  usePets.ts usePet.ts useCreatePet.ts usePhotoUpload.ts useEntitlement.ts useProfile.ts
   ├─ src/features/<onboarding|auth|home|pets|photos|plans|account|placeholders>/  screens + copy.ts
   ├─ src/photo/preparePhoto.ts   src/offline/useOnline.ts  src/offline/draft.ts
   ├─ src/observability/sentry.ts
   └─ e2e/maestro/*.yaml  e2e/web/*.spec.ts  e2e/support/mailpit.ts  e2e/fixtures/*.jpg
```

---

### Task 1: Workspace scaffold and `pnpm verify`

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml` (`apps/*`, `packages/*`), `.npmrc` (`node-linker=hoisted`), `tsconfig.base.json`, `eslint.config.js`, `.prettierrc`, `.gitignore` (node_modules, .expo, dist, supabase/.temp, .env*), `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/index.test.ts`

**Interfaces:**
- Produces: root scripts `typecheck`, `lint`, `test`, `verify` (`pnpm typecheck && pnpm lint && pnpm test`). Each package exposes `typecheck` (`tsc --noEmit`) and `test`. Later tasks register their own `test:*` scripts and add them to root `test`.

- [ ] **Step 1: Write the failing smoke test**

```ts
import { describe, expect, it } from 'vitest'
import * as core from './index'
describe('@meoofy/core', () => {
  it('exports a package marker', () => { expect(core.PACKAGE).toBe('@meoofy/core') })
})
```

- [ ] **Step 2: Run `pnpm --filter @meoofy/core test` and confirm it fails because `PACKAGE` is undefined.**
- [ ] **Step 3: Add `export const PACKAGE = '@meoofy/core'` and the workspace/config files listed above.**
- [ ] **Step 4: Run `pnpm install && pnpm verify` and confirm typecheck, lint and 1 test pass.**
- [ ] **Step 5: Commit** — `chore: scaffold pnpm workspace and verify pipeline`

---

### Task 2: Core limits, tiers, validation and age

**Files:**
- Create: `packages/core/src/limits.ts`, `tiers.ts`, `schemas.ts`, `age.ts`; modify `index.ts` (re-export; drop nothing)
- Test: `packages/core/src/limits.test.ts`, `tiers.test.ts`, `schemas.test.ts`, `age.test.ts`

**Interfaces:**
- Produces:
  - `LIMITS` (const object holding every value in Global Constraints, keys: `petNameMax 40`, `breedMax 80`, `ageMonthsMax 360`, `ageYearsMax 30`, `displayNameMax 40`, `photosPerPet 6`, `photoMaxBytes 4194304`, `photoMinShortSide 720`, `photoLongEdge 1600`, `photoJpegQuality 0.8`, `analysisSize 512`, `brightnessMin 40`, `brightnessMax 220`, `blurMin 80`, `uploadsPerHour 30`, `signedUrlSeconds 3600`, `pendingPhotoTtlHours 24`)
  - `type Tier = 'free' | 'pro' | 'max'`
  - `petLimit(tier: Tier): number | null`
  - `canAddPet(tier: Tier, activePets: number): boolean`
  - `codePointLength(s: string): number`
  - zod schemas `speciesSchema`, `photoViewSchema`, `onboardingPathSchema`, `petInputSchema`, `petPatchSchema` (partial without `id`), `displayNameSchema`, `photoRequestSchema`, with inferred types `Species`, `PhotoView`, `OnboardingPath`, `PetInput`, `PetPatch`, `PhotoRequest`
  - `toAgeMonths(years: number, months?: number): number`
  - `formatAge(ageMonths: number | null): string`

- [ ] **Step 1: Write the failing tests**

```ts
// tiers.test.ts
expect(petLimit('free')).toBe(3); expect(petLimit('pro')).toBe(10); expect(petLimit('max')).toBeNull()
expect(canAddPet('free', 2)).toBe(true); expect(canAddPet('free', 3)).toBe(false); expect(canAddPet('max', 999)).toBe(true)
// schemas.test.ts
const base = { id: '7b6f3a52-6a0c-4a43-9a1e-2f0b6f0a9d11', name: 'Milo', species: 'dog', breed: null, ageMonths: 36 }
expect(petInputSchema.parse({ ...base, name: '  Milo  ' }).name).toBe('Milo')
expect(petInputSchema.safeParse({ ...base, name: '   ' }).success).toBe(false)
it('counts code points', () => {
  expect(petInputSchema.safeParse({ ...base, name: '🐶'.repeat(40) }).success).toBe(true)
  expect(petInputSchema.safeParse({ ...base, name: '🐶'.repeat(41) }).success).toBe(false)
})
expect(petInputSchema.parse({ ...base, breed: '' }).breed).toBeNull()
expect(petInputSchema.safeParse({ ...base, breed: 'x'.repeat(81) }).success).toBe(false)
expect(petInputSchema.safeParse({ ...base, ageMonths: 361 }).success).toBe(false)
expect(petInputSchema.safeParse({ ...base, species: 'rabbit' }).success).toBe(false)
expect(photoRequestSchema.safeParse({ id: base.id, petId: base.id, view: 'front', contentType: 'image/png', bytes: 10 }).success).toBe(false)
expect(photoRequestSchema.safeParse({ id: base.id, petId: base.id, view: 'side', contentType: 'image/jpeg', bytes: 4194305 }).success).toBe(false)
expect(displayNameSchema.safeParse('A'.repeat(41)).success).toBe(false)
// age.test.ts
expect(toAgeMonths(3)).toBe(36); expect(toAgeMonths(2, 3)).toBe(27)
expect(() => toAgeMonths(31)).toThrow(); expect(() => toAgeMonths(1, 12)).toThrow()
expect(formatAge(36)).toBe('3 years'); expect(formatAge(14)).toBe('1 year 2 months')
expect(formatAge(12)).toBe('1 year'); expect(formatAge(5)).toBe('5 months'); expect(formatAge(1)).toBe('1 month'); expect(formatAge(null)).toBe('')
```

- [ ] **Step 2: Run `pnpm --filter @meoofy/core test` and confirm the new tests fail.**
- [ ] **Step 3: Implement the interfaces above.** Use zod `.transform(trim)` then `.refine(s => codePointLength(s) >= 1 && <= max)`. Breed normalises `''` to `null`. `contentType` is `z.literal('image/jpeg')`.
- [ ] **Step 4: Run the tests and confirm all pass.**
- [ ] **Step 5: Commit** — `feat(core): domain limits, tiers, validation and age helpers`

---

### Task 3: Core errors and photo quality analysis

**Files:**
- Create: `packages/core/src/errors.ts`, `photoQuality.ts`
- Test: `packages/core/src/errors.test.ts`, `photoQuality.test.ts`

**Interfaces:**
- Produces:
  - `ERROR_CODES` (readonly tuple of the 9 codes) and `type ErrorCode`
  - `class AppError extends Error { readonly code: ErrorCode; readonly retryable: boolean }`. `retryable` is true only for `NETWORK` and `RATE_LIMITED`.
  - `parseAppError(e: unknown): AppError`
  - `analyzeGray(pixels: Uint8Array, width: number, height: number): { brightness: number; blurScore: number }`
  - `assessPhoto(m: { brightness: number; blurScore: number; width: number; height: number }): { ok: true } | { ok: false; reason: 'TOO_SMALL' | 'TOO_DARK' | 'TOO_BRIGHT' | 'BLURRY' }`

- [ ] **Step 1: Write the failing tests**

```ts
// errors.test.ts
expect(parseAppError({ message: 'MEOOFY:PET_LIMIT_REACHED', code: 'P0001' }).code).toBe('PET_LIMIT_REACHED')
expect(parseAppError(new TypeError('Network request failed')).code).toBe('NETWORK')
expect(parseAppError(new TypeError('Failed to fetch')).retryable).toBe(true)
expect(parseAppError({ message: 'This pilot is invite-only' }).code).toBe('INVITE_ONLY')
expect(parseAppError({ status: 401, message: 'JWT expired' }).code).toBe('UNAUTHENTICATED')
expect(parseAppError('weird').code).toBe('UNKNOWN')
expect(parseAppError({ message: 'MEOOFY:RATE_LIMITED' }).retryable).toBe(true)
expect(parseAppError({ message: 'MEOOFY:VALIDATION' }).retryable).toBe(false)
// photoQuality.test.ts
const flat = new Uint8Array(64 * 64).fill(128)
expect(analyzeGray(flat, 64, 64)).toEqual({ brightness: 128, blurScore: 0 })
const checker = Uint8Array.from({ length: 64 * 64 }, (_, i) => ((i % 64) + Math.floor(i / 64)) % 2 ? 255 : 0)
expect(analyzeGray(checker, 64, 64).blurScore).toBeGreaterThan(80)
expect(assessPhoto({ brightness: 120, blurScore: 200, width: 1600, height: 719 })).toEqual({ ok: false, reason: 'TOO_SMALL' })
expect(assessPhoto({ brightness: 39, blurScore: 200, width: 1600, height: 1200 })).toEqual({ ok: false, reason: 'TOO_DARK' })
expect(assessPhoto({ brightness: 221, blurScore: 200, width: 1600, height: 1200 })).toEqual({ ok: false, reason: 'TOO_BRIGHT' })
expect(assessPhoto({ brightness: 120, blurScore: 79.9, width: 1600, height: 1200 })).toEqual({ ok: false, reason: 'BLURRY' })
expect(assessPhoto({ brightness: 40, blurScore: 80, width: 1200, height: 720 })).toEqual({ ok: true })
```

- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
  - `parseAppError`: match `/MEOOFY:([A-Z_]+)/` in `message`. Network `TypeError`s → `NETWORK`. Status 401 or a JWT message → `UNAUTHENTICATED`. A message containing `invite-only` → `INVITE_ONLY`. Anything else → `UNKNOWN`.
  - `analyzeGray`: brightness is the mean. Blur is the variance of the 4-neighbour Laplacian (`4·p − up − down − left − right`) over interior pixels.
  - `assessPhoto`: checks in the order shown, using `LIMITS`.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** — `feat(core): typed app errors and photo quality analysis`

---

### Task 4: Supabase schema, row-level security and SQL limit parity

**Files:**
- Create: `supabase/config.toml` (via `pnpm dlx supabase@2.121.0 init`, then edit), `packages/core/src/sqlLimits.ts`, `packages/core/scripts/emit-sql-limits.ts`, `supabase/migrations/20261023000000_limits.sql` (generated), `20261023000001_schema.sql`, `20261023000002_rls.sql`, `supabase/tests/database/000_helpers.sql`, `010_schema_rls.test.sql`
- Test: `packages/core/src/sqlLimits.test.ts`, `supabase/tests/database/010_schema_rls.test.sql`
- Modify: root `package.json` (scripts `db:start` = `supabase start`, `db:reset` = `supabase db reset`, `test:db` = `supabase test db`, `gen:sql-limits`)

**Interfaces:**
- Consumes: `LIMITS`, `petLimit` (Task 2).
- Produces:
  - Tables and enums exactly as spec §5, plus `registry.storage_deletions(id bigserial, storage_path text, requested_at timestamptz default now(), attempts int default 0, last_error text)` and `identity.pilot_allowlist`.
  - SQL `registry.limits() returns jsonb` (immutable).
  - `entitlements.pet_limit(tier entitlements.tier) returns int`, returning null for max.
  - `internal.fail(code text, detail text default null)`, which raises `MEOOFY:<code>`.
  - Trigger `identity.on_auth_user_created` on `auth.users` insert. It inserts `identity.profiles(id, display_name)`, using `raw_user_meta_data->>'given_name'`, else `full_name`, else `''`, trimmed to 40. It also inserts `entitlements.accounts(owner_id)`.
  - Test helpers `tests.create_user(email text) returns uuid`, `tests.authenticate_as(uid uuid)`, `tests.clear_auth()`.
- `config.toml`:
  - Expose schemas `api` and `graphql_public` only.
  - `[auth.email] enable_signup = true, otp_length = 6, otp_expiry = 600`.
  - `[auth.external.apple] enabled = true` with `client_id`/`secret` read from env.

- [ ] **Step 1: Write the failing parity test**

```ts
// sqlLimits.test.ts
import { readFileSync } from 'node:fs'
const sql = readFileSync(new URL('../../../supabase/migrations/20261023000000_limits.sql', import.meta.url), 'utf8')
const json = JSON.parse(sql.match(/'(\{.*\})'::jsonb/s)![1])
expect(json).toEqual(sqlLimits())
expect(sqlLimits()).toMatchObject({ petNameMax: 40, breedMax: 80, ageMonthsMax: 360, photosPerPet: 6, photoMaxBytes: 4194304, photoMinShortSide: 720, uploadsPerHour: 30, tierLimits: { free: 3, pro: 10, max: null } })
```

- [ ] **Step 2: Write the failing pgTAP test `010_schema_rls.test.sql`** (wrapped in `begin; … rollback;`) with these assertions:
  - `has_table` for every spec §5 table.
  - `table_privs_are('registry','pets','authenticated', array['SELECT'])`, and the same for `pet_photos`, `profiles`, `accounts`, `events`.
  - `results_eq` showing a new auth user gets one profile row and one free account row.
  - `tests.authenticate_as(userB)` sees 0 of user A's pets (A's rows inserted as `postgres`).
  - Inserting into `registry.pets` as `authenticated` throws `42501`.
  - `select entitlements.pet_limit('free') = 3`, and `pet_limit('max') is null`.
- [ ] **Step 3: Run `pnpm db:start`, then `pnpm --filter @meoofy/core test` and `pnpm test:db`, and confirm both fail.**
- [ ] **Step 4: Implement the pieces.**
  - `sqlLimits()` maps `LIMITS` plus `tierLimits` into the JSON shape.
  - `emit-sql-limits.ts` writes the migration: `create or replace function registry.limits() returns jsonb language sql immutable as $$ select '<json>'::jsonb $$;`.
  - Write the schema migration (schemas, enums, tables, checks using `char_length`, the `updated_at` trigger, the auth trigger, `entitlements.pet_limit`, `internal.fail`, grants: `usage` on `api` to `authenticated`; `select` only on the tables).
  - Write the RLS migration: enable RLS on every table, add owner select policies, no write policies.
  - Write `000_helpers.sql`. It has no begin/rollback, so the helpers persist across test files. It ends with `select plan(1); select pass('helpers'); select * from finish();`.
- [ ] **Step 5: Run `pnpm gen:sql-limits && pnpm db:reset && pnpm test:db && pnpm --filter @meoofy/core test` and confirm all pass.**
- [ ] **Step 6: Commit** — `feat(db): schemas, tables, RLS and generated SQL limits`

---

### Task 5: Audit log and profile/onboarding functions

**Files:**
- Create: `supabase/migrations/20261023000003_audit.sql`, `20261023000004_profile_api.sql`
- Test: `supabase/tests/database/020_profile.test.sql`

**Interfaces:**
- Consumes: tables, `internal.fail` (Task 4).
- Produces:
  - `audit.record(action text, subject_type text, subject_id uuid, metadata jsonb default '{}')`, which uses `actor_id = auth.uid()`.
  - `audit.record_system(action text, subject_type text, subject_id uuid default null, metadata jsonb default '{}')`, with `actor_id` null and callable only by `service_role`.
  - `api.complete_onboarding(path identity.onboarding_path) returns void`.
  - `api.update_profile(display_name text) returns void`.

- [ ] **Step 1: Write the failing pgTAP tests:**
  - Unauthenticated `api.update_profile('Alex')` throws `MEOOFY:UNAUTHENTICATED`.
  - `update_profile('  Alex  ')` stores `Alex` and writes one `profile.updated` event, whose metadata has no `display_name` key.
  - `update_profile('   ')` and a 41-character name throw `MEOOFY:VALIDATION`.
  - `complete_onboarding('owner')` called twice leaves one completion timestamp (unchanged on the second call) and writes 1 event.
  - `authenticated` cannot `update`/`delete` `audit.events` (`42501`).
- [ ] **Step 2: Run `pnpm test:db` and confirm the new file fails.**
- [ ] **Step 3: Implement both migrations.** All `api.*` functions are `security definer set search_path = ''` with fully qualified names, and `grant execute … to authenticated`. Revoke the defaults from `public`.
- [ ] **Step 4: Run `pnpm db:reset && pnpm test:db` and confirm it passes.**
- [ ] **Step 5: Commit** — `feat(db): audit log and profile/onboarding functions`

---

### Task 6: Pet functions with tier limit and idempotency

**Files:**
- Create: `supabase/migrations/20261023000005_pet_api.sql`
- Test: `supabase/tests/database/030_pets.test.sql`

**Interfaces:**
- Consumes: `audit.record`, `entitlements.pet_limit`, `internal.fail`.
- Produces:
  - `api.create_pet(id uuid, name text, species registry.species, breed text, age_months int) returns registry.pets`
  - `api.update_pet(id uuid, name text default null, species registry.species default null, breed text default null, age_months int default null, clear_breed boolean default false, clear_age boolean default false) returns registry.pets`
  - `api.delete_pet(id uuid) returns void`

- [ ] **Step 1: Write the failing pgTAP tests:**
  - User A creates 3 pets. The 4th throws `MEOOFY:PET_LIMIT_REACHED`.
  - Setting A's tier to `pro` (as postgres) then allows a 4th.
  - Repeating `create_pet` with an existing id and the same owner returns that row and adds no row and no event.
  - Using user A's pet id as user B throws `MEOOFY:NOT_OWNER`.
  - `create_pet accepts 40 emoji`: `repeat('🐶',40)` is accepted and `repeat('🐶',41)` throws `MEOOFY:VALIDATION`.
  - Names `'   '`, breed over 80, `age_months` 361 → `MEOOFY:VALIDATION`.
  - `update_pet` with `clear_breed => true` sets breed null.
  - B updating or deleting A's pet → `MEOOFY:NOT_OWNER`.
  - `delete_pet` removes the row, cascades photos, inserts one `registry.storage_deletions` row per photo path, and writes `pet.deleted`.
  - Archived pets don't count toward the limit.
  - Every success writes exactly one audit event with an empty or name-free `metadata`.
- [ ] **Step 2: Run `pnpm test:db` and confirm it fails.**
- [ ] **Step 3: Implement `create_pet`.** This order makes concurrent creates safe:

```sql
perform 1 from entitlements.accounts where owner_id = auth.uid() for update;  -- serialises creates per owner
if exists (select 1 from registry.pets where id = create_pet.id and owner_id = auth.uid()) then return (that row); end if;
if entitlements.pet_limit(tier) is not null and (select count(*) from registry.pets where owner_id = auth.uid() and registration_state = 'private') >= entitlements.pet_limit(tier) then perform internal.fail('PET_LIMIT_REACHED'); end if;
```

  If an existing id belongs to another owner, fail with `NOT_OWNER`. Validation trims, uses `char_length` against `registry.limits()`, and turns empty breed into null.
- [ ] **Step 4: Run `pnpm db:reset && pnpm test:db` and confirm it passes.**
- [ ] **Step 5: Commit** — `feat(db): pet functions with tier limit, idempotency and audit`

---

### Task 7: Photo functions and private storage

**Files:**
- Create: `supabase/migrations/20261023000006_photo_api.sql` (bucket `pet-photos`, `public = false`, `file_size_limit = 4194304`, `allowed_mime_types = '{image/jpeg}'`, storage policies, functions)
- Test: `supabase/tests/database/040_photos.test.sql`

**Interfaces:**
- Consumes: Task 6 tables and helpers.
- Produces:
  - `api.request_photo_upload(id uuid, pet_id uuid, view registry.photo_view, content_type text, bytes int) returns text`. It returns the storage path `{owner}/{pet}/{id}.jpg`.
  - `api.confirm_photo(id uuid, width int, height int, blur_score real, brightness real) returns registry.pet_photos`
  - `api.delete_photo(id uuid) returns void`
  - Storage policies on `storage.objects` for bucket `pet-photos`:
    - insert: first path segment = `auth.uid()::text`, and a `pending` row owned by the caller has that exact path;
    - select: first segment = `auth.uid()::text`;
    - no update or delete policies.

- [ ] **Step 1: Write the failing pgTAP tests:**
  - `request_photo_upload` returns `<A>/<pet>/<photo>.jpg` and creates a `pending` row.
  - `content_type 'image/png'` and `bytes 4194305` → `MEOOFY:VALIDATION`.
  - A 7th non-rejected photo → `MEOOFY:VALIDATION`.
  - The 31st request within an hour → `MEOOFY:RATE_LIMITED`. Count `photo.upload_requested` audit events in the last hour.
  - B requesting for A's pet → `MEOOFY:NOT_OWNER`.
  - `confirm_photo` without a `storage.objects` row → `MEOOFY:PHOTO_QUALITY`. With a row but `height 719` → `MEOOFY:PHOTO_QUALITY`. Valid → `ready` with `confirmed_at` set.
  - `confirm_photo replaces same view`: a second ready `front` photo leaves exactly one ready `front`, and queues the old path in `registry.storage_deletions`.
  - As `authenticated` A: inserting a `storage.objects` row at path `<B>/…` fails, and A's pending path succeeds. Selecting B's objects returns 0 rows.
  - `delete_photo` queues the path and removes the row.
- [ ] **Step 2: Run `pnpm test:db` and confirm it fails.**
- [ ] **Step 3: Implement the migration as specified** (limits read from `registry.limits()`; one audit event per call: `photo.upload_requested`, `photo.added`, `photo.deleted`).
- [ ] **Step 4: Run `pnpm db:reset && pnpm test:db` and confirm it passes.**
- [ ] **Step 5: Commit** — `feat(db): photo functions and private storage policies`

---

### Task 8: Pilot allowlist auth hook

**Files:**
- Create: `supabase/migrations/20261023000007_auth_hook.sql` (`identity.signup_rejections(email citext, rejected_at timestamptz default now())`, `identity.before_user_created(event jsonb) returns jsonb`, grants to `supabase_auth_admin` only)
- Modify: `supabase/config.toml` (`[auth.hook.before_user_created] enabled = true, uri = "pg-functions://postgres/identity/before_user_created"`), `supabase/seed.sql` (allowlist `owner@meoofy.test`, `e2e@meoofy.test`)
- Test: `supabase/tests/database/050_auth_hook.test.sql`

**Interfaces:**
- Produces: the hook returns `'{}'::jsonb` for an allowlisted email (case-insensitive). Otherwise it returns `{"error":{"http_code":403,"message":"This pilot is invite-only"}}` and inserts the email into `identity.signup_rejections`.

- [ ] **Step 1: Write the failing pgTAP tests:**
  - `identity.before_user_created('{"user":{"email":"Owner@Meoofy.test"}}')` returns `{}`.
  - An unknown relay address `abc@privaterelay.appleid.com` returns the 403 error and is logged in `signup_rejections`.
  - `authenticated` cannot select `identity.pilot_allowlist` or `identity.signup_rejections` (`42501`).
- [ ] **Step 2: Run `pnpm test:db` and confirm it fails.**
- [ ] **Step 3: Implement the migration and config.**
- [ ] **Step 4: Run `pnpm db:reset && pnpm test:db` and confirm it passes.**
- [ ] **Step 5: Commit** — `feat(auth): pilot allowlist hook with rejection log`

---

### Task 9: Edge Functions for account deletion and storage cleanup

**Files:**
- Create: `supabase/functions/_shared/deleteAccount.ts`, `_shared/cleanup.ts`, `_shared/deleteAccount_test.ts`, `_shared/cleanup_test.ts`, `supabase/functions/delete-account/index.ts`, `supabase/functions/storage-cleanup/index.ts`, `supabase/migrations/20261023000008_cleanup.sql`
- Test: `supabase/functions/_shared/*_test.ts` (Deno), `supabase/tests/database/060_cleanup.test.sql`

**Interfaces:**
- Consumes: `registry.storage_deletions`, `audit.record_system`.
- Produces:
  - `deleteAccount(uid: string, deps: { listPaths(prefix: string): Promise<string[]>; removePaths(paths: string[]): Promise<void>; recordAudit(action: string): Promise<void>; deleteUser(uid: string): Promise<void> }): Promise<void>`. Removes files in chunks of 1000, then records `account.deleted`, then deletes the user.
  - `runCleanup(deps: { enqueueStale(): Promise<number>; claim(limit: number): Promise<{ id: number; storage_path: string }[]>; remove(paths: string[]): Promise<{ failed: string[] }>; complete(doneIds: number[], failed: { id: number; error: string }[]): Promise<void> }): Promise<{ removed: number; failed: number }>`
  - SQL functions, all `service_role` only:
    - `registry.enqueue_stale_photos() returns int`: pending older than `pendingPhotoTtlHours`, plus storage objects with no row.
    - `registry.claim_storage_deletions(max int) returns setof registry.storage_deletions`: `for update skip locked`, increments `attempts`.
    - `registry.complete_storage_deletions(done bigint[], failed jsonb)`.
  - Cron job `storage-cleanup` (`*/5 * * * *`) calls the function via `net.http_post`, with the URL and service key read from `vault.decrypted_secrets` (`project_url`, `service_role_key`).
  - `delete-account` accepts POST with the caller's JWT and returns 204. Without a valid JWT it returns 401 `{"error":"MEOOFY:UNAUTHENTICATED"}`.

- [ ] **Step 1: Write the failing Deno tests:**
  - `deleteAccount` with 2500 fake paths calls `removePaths` 3 times (1000/1000/500), then `recordAudit('account.deleted')`, then `deleteUser(uid)`, in that order.
  - If `removePaths` throws, `deleteUser` is not called.
  - `runCleanup` with 3 claimed rows where 1 path fails → returns `{ removed: 2, failed: 1 }` and `complete` gets 2 done ids plus 1 failure.
- [ ] **Step 2: Write the failing pgTAP test `060_cleanup.test.sql`:**
  - A pending photo created 25 h ago gets enqueued, and one created 1 h ago does not.
  - `claim_storage_deletions(10)` increments `attempts`.
  - `authenticated` cannot execute any of the three functions.
- [ ] **Step 3: Run `deno test supabase/functions/_shared` and `pnpm test:db` and confirm both fail.**
- [ ] **Step 4: Implement the shared logic, the thin `index.ts` handlers (service-role client from `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` env), the SQL functions and the cron schedule.** Add the root script `test:functions` = `deno test supabase/functions/_shared`.
- [ ] **Step 5: Run `deno test supabase/functions/_shared && pnpm db:reset && pnpm test:db` and confirm all pass.**
- [ ] **Step 6: Commit** — `feat(functions): account deletion and storage cleanup jobs`

---

### Task 10: API client, auth, profile and entitlements

**Files:**
- Create: `packages/api/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/client.ts`, `src/database.types.ts` (generated: `supabase gen types typescript --local --schema api,registry,identity,entitlements > …`), `src/types.ts`, `src/auth.ts`, `src/profile.ts`, `src/entitlements.ts`, `src/index.ts`, `test/helpers.ts`, `test/auth.int.test.ts`, `test/profile.int.test.ts`
- Modify: root `package.json` (`gen:types`, `test:api` = `pnpm --filter @meoofy/api test`)

**Interfaces:**
- Consumes: `parseAppError`, `AppError`, `petLimit`, `Tier`, `OnboardingPath`, `displayNameSchema` (core). DB functions from Tasks 4–9.
- Produces:
  - `createMeoofyClient(opts: { url: string; anonKey: string; storage?: { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void>; removeItem(k: string): Promise<void> } }): MeoofyClient`
  - `type MeoofyClient = SupabaseClient<Database>`
  - `sendEmailCode(c, email: string): Promise<void>`
  - `verifyEmailCode(c, email: string, code: string): Promise<void>`
  - `signInWithAppleIdToken(c, idToken: string, nonce: string): Promise<void>`
  - `signOut(c): Promise<void>`
  - `deleteAccount(c): Promise<void>`
  - `getProfile(c): Promise<Profile>` where `Profile = { id: string; displayName: string; onboardingPath: OnboardingPath | null; onboardingCompletedAt: string | null }`
  - `completeOnboarding(c, path: OnboardingPath): Promise<void>`
  - `updateDisplayName(c, name: string): Promise<void>`
  - `getEntitlement(c): Promise<{ tier: Tier; petLimit: number | null; activePets: number }>`
  - Every exported function rejects with `AppError` only. Raw supabase errors never escape.
  - Test helper `test/helpers.ts`: `newOwner(email?: string): Promise<{ client: MeoofyClient; userId: string; email: string }>`. It allowlists the email, creates the user with the admin API (password, `email_confirm: true`), and signs in with the password. It also exports `admin` (service-role client) and `latestEmailCode(email): Promise<string>`, which reads Mailpit at `http://127.0.0.1:54324/api/v1/messages`.

- [ ] **Step 1: Write the failing integration tests:**
  - `sendEmailCode` + `latestEmailCode` + `verifyEmailCode` signs in an allowlisted user. A wrong code rejects with `AppError` code `UNAUTHENTICATED`.
  - `sendEmailCode('stranger@meoofy.test')` then verifying rejects with `INVITE_ONLY`.
  - `updateDisplayName('  Alex ')` → `getProfile().displayName === 'Alex'`. `updateDisplayName('')` rejects `VALIDATION` without a network call (validated with `displayNameSchema` first).
  - `getEntitlement()` returns `{ tier: 'free', petLimit: 3, activePets: 0 }`.
  - `expired session maps to UNAUTHENTICATED`: after `admin.auth.admin.signOut(jwt)` (or deleting the user), `getProfile()` rejects with code `UNAUTHENTICATED`.
  - `deleteAccount()` (with `supabase functions serve` running) removes the user, so `admin.auth.admin.getUserById` returns not found.
- [ ] **Step 2: Run `pnpm db:reset`, start `pnpm dlx supabase@2.121.0 functions serve` in a second terminal, then run `pnpm test:api` and confirm it fails.**
- [ ] **Step 3: Implement the modules.** Wrap each call in `try/catch → throw parseAppError(e)`. Map rows to camelCase types in `types.ts`.
- [ ] **Step 4: Run `pnpm gen:types && pnpm test:api` and confirm it passes.**
- [ ] **Step 5: Commit** — `feat(api): typed client, auth, profile and entitlements`

---

### Task 11: API pets and photos

**Files:**
- Create: `packages/api/src/pets.ts`, `src/photos.ts`, `test/pets.int.test.ts`, `test/photos.int.test.ts`
- Modify: `packages/api/src/index.ts`, `packages/api/test/helpers.ts` (add `makeTestJpeg(width: number, height: number, seed?: number): ArrayBuffer`, a deterministic high-texture image encoded with `jpeg-js` at quality 80 that passes `assessPhoto`; Task 24's fixture generator reuses it)

**Interfaces:**
- Consumes: `petInputSchema`, `petPatchSchema`, `photoRequestSchema`, `LIMITS` (core). Client from Task 10.
- Produces:
  - `type Pet = { id: string; name: string; species: Species; breed: string | null; ageMonths: number | null; registrationState: 'private' | 'archived'; discoveryEnabled: boolean; createdAt: string }`
  - `listPets(c): Promise<Pet[]>`, ordered by `createdAt` ascending.
  - `getPet(c, id: string): Promise<Pet | null>`
  - `createPet(c, input: PetInput): Promise<Pet>`
  - `updatePet(c, id: string, patch: PetPatch): Promise<Pet>`
  - `deletePet(c, id: string): Promise<void>`
  - `type PetPhoto = { id: string; petId: string; view: PhotoView; status: 'pending' | 'ready' | 'rejected'; width: number; height: number; signedUrl: string | null }`
  - `listPhotos(c, petId: string): Promise<PetPhoto[]>`, with a 3600 s signed URL for ready photos.
  - `uploadPhoto(c, a: { id: string; petId: string; view: PhotoView; jpeg: ArrayBuffer; width: number; height: number; blurScore: number; brightness: number }): Promise<PetPhoto>`, which runs request → `storage.upload(path, jpeg, { contentType: 'image/jpeg', upsert: false })` → confirm.
  - `deletePhoto(c, id: string): Promise<void>`

- [ ] **Step 1: Write the failing integration tests:**
  - Lifecycle: create → list (1) → update name → get → delete → list (0).
  - `concurrent creates never exceed the limit`: with 2 existing pets, `Promise.allSettled([createPet(a), createPet(b)])` gives exactly 1 fulfilled and 1 rejected with `PET_LIMIT_REACHED`, and then `listPets` returns 3.
  - Retrying `createPet` with the same id returns the same pet, and the count is unchanged.
  - Owner B's `listPets` never includes A's pets. B's `getPet(aPetId)` returns `null`.
  - Uploading `makeTestJpeg(1600, 1200)` → `listPhotos` shows one `ready` front photo whose `signedUrl` fetches with HTTP 200.
  - Uploading a second front photo leaves one front photo.
  - `uploadPhoto` with `height: 600` rejects `PHOTO_QUALITY` and leaves the row `pending` (retryable).
  - `deletePet` → the queued path count increases by the pet's photo count (checked through `admin`).
- [ ] **Step 2: Run `pnpm test:api` and confirm it fails.**
- [ ] **Step 3: Implement `pets.ts` and `photos.ts`.** Validate with the core schemas before any network call. In `updatePet`, a patch value of `null` for `breed` or `ageMonths` maps to `clear_breed` / `clear_age = true`.
- [ ] **Step 4: Run `pnpm test:api` and confirm it passes.**
- [ ] **Step 5: Commit** — `feat(api): pets and photo upload lifecycle`

---

### Task 12: UI tokens, colour roles and type scale

**Files:**
- Create: `packages/ui/package.json`, `tsconfig.json`, `jest.config.js` (`preset: 'jest-expo'`), `tools/tokens/build-tokens.ts`, `packages/ui/src/theme/tokens.ts` (generated), `src/theme/roles.ts`, `src/theme/type.ts`, `src/index.ts`
- Test: `packages/ui/src/theme/theme.test.ts`

**Interfaces:**
- Consumes: `tools/tokens/figma-tokens.json`. `Motion/*` values are exported with unit `px` but mean milliseconds. Space values are px.
- Produces:
  - `colors`: camelCase `Palette/*` names (`cloud #F8FBFF`, `sky #74C3FF`, `cobalt #2858C8`, `deepBlue #183B73`, `moonYellow #FFD95A`, `softYellow #FFF2AE`, `mistGray #E8EDF4`, `slate #465268`, `cocoa #896341`, `sand #D7B589`, `ink #1D2A3A`, `white #FFFFFF`, `lavender #E6E1FF`, `blush #FFB3C6`, `twilight #6E8FE8`, `mint #D9F5EA`, `leaf #1C7055`, `peach #FFE4CF`, `ember #A04E1C`, `petal #FFE3EC`, `rose #B03562`, `iris #5B4FC9`), plus `line #D9E3F0` and `skyTint #DCEEFF` from `Color/Line` and `Color/Mint`.
  - `space` (8, 16, 24, 32, 48, 64).
  - `radii = { card: 24, button: 16, field: 12, chip: 16 }`.
  - `motion = { duration: { instant: 80, fast: 160, base: 240, gentle: 420, burst: 900, twinkle: 1600, floatLoop: 3200 }, stagger: { trail: 120, float: 400 }, easing: { standard: [0.2,0.8,0.2,1], peel: [0.34,1.56,0.64,1], float: [0.45,0,0.55,1], burst: [0.16,1,0.3,1], exit: [0.4,0,1,1] }, floatDistance: 10, tiltMax: 12 }`.
  - `type CardRole = 'privacy' | 'tip' | 'community' | 'warning' | 'celebration' | 'attention' | 'plain'` and `cardRoles: Record<CardRole, { from: string; to: string; title: string; body: string; stroke?: string }>`, with values:
    - privacy `#DCEEFF→#E8F1FF`, title/body `#2858C8`
    - tip `#D9F5EA→#EAFAF3`, title `#1C7055`, body `#2A6450`
    - community `#E9E5FF→#F3F0FF`, title `#5B4FC9`, body `#4B4396`
    - warning `#FFE4CF→#FFF0E4`, title `#A04E1C`, body `#7E4019`
    - celebration `#FFE3EC→#FFF1F5`, title `#B03562`, body `#7D3350`
    - attention `#FFF2AE→#FFF8D6`, title `#7A5A00`, body `#6B5300`
    - plain `#FFFFFF→#FFFFFF`, title `#183B73`, body `#465268`, stroke `#E9EEF6`
  - `type Flow = 'onboarding' | 'owner' | 'finder' | 'recovery' | 'outcomes' | 'resilience'` and `flowTints: Record<Flow, { tint: string; glowA: string; glowB: string }>`:
    - owner `#E6F2FF / #FFF2AE / #CFE6FF`
    - finder `#E3F7EF / #C9F0E0 / #DCEEFF`
    - recovery `#FFEEF3 / #FFD3E0 / #E6E1FF`
    - outcomes `#EFEBFF / #DCD5FF / #FFE1CC`
    - resilience `#FFF1E6 / #FFE1C8 / #FFF2AE`
    - onboarding `#E9F3FF / #FFF2AE / #E6E1FF`
  - `type`: entries `headline {28, 39, '700'}`, `section {22, 28, '600'}`, `cardTitle {17, 22, '600'}`, `noteTitle {15, 20, '600'}`, `body {14, 20, '400'}`, `small {13, 18, '400'}`, `caption {12, 16, '400'}`. Font family is `Inter_<weight>`.

- [ ] **Step 1: Write the failing test:**

```ts
expect(colors.cobalt).toBe('#2858C8'); expect(colors.leaf).toBe('#1C7055'); expect(colors.line).toBe('#D9E3F0')
expect(motion.duration.gentle).toBe(420); expect(motion.easing.peel).toEqual([0.34, 1.56, 0.64, 1])
expect(cardRoles.tip).toEqual({ from: '#D9F5EA', to: '#EAFAF3', title: '#1C7055', body: '#2A6450' })
expect(flowTints.owner.tint).toBe('#E6F2FF'); expect(type.headline).toMatchObject({ fontSize: 28, lineHeight: 39 })
```

- [ ] **Step 2: Run `pnpm --filter @meoofy/ui test` and confirm it fails.**
- [ ] **Step 3: Implement `build-tokens.ts`** (reads the JSON and writes `tokens.ts` with a `// generated` header; script `gen:tokens`). Hand-write `roles.ts` and `type.ts`.
- [ ] **Step 4: Run `pnpm gen:tokens && pnpm --filter @meoofy/ui test` and confirm it passes.**
- [ ] **Step 5: Commit** — `feat(ui): design tokens, colour roles and type scale`

---

### Task 13: UI primitives

**Files:**
- Create: `packages/ui/src/primitives/Button.tsx`, `Field.tsx`, `Switch.tsx`, `Checkbox.tsx`, `Chip.tsx`, `Card.tsx`, `PrivacyBanner.tsx`, `StepDots.tsx`, `ScreenShell.tsx`, `TabBar.tsx`, `WebNav.tsx`
- Test: `packages/ui/src/primitives/primitives.test.tsx`

**Interfaces:**
- Consumes: Task 12 theme.
- Produces:
  - `Button({ label, onPress, variant: 'primary' | 'secondary' | 'urgent', disabled?, loading? })`: 48 pt high, radius 16, `accessibilityRole="button"`.
  - `Field({ label, value, onChangeText, error?, ...TextInputProps })`
  - `Switch({ value, onValueChange, label })`
  - `Checkbox({ checked, onChange, label })`
  - `Chip({ kind: 'private' | 'missing' | 'recovered' })`
  - `Card({ role: CardRole, title?, children })`: vertical gradient `from → to`, title in the role's `title` colour.
  - `PrivacyBanner({ text })`
  - `StepDots({ count, current })`
  - `ScreenShell({ flow: Flow, children, scroll? })`: tint gradient (tint → `#F7F5FF` → `#F8FBFF`) plus two blurred glows (`glowA` top-right, `glowB` bottom-left) and safe-area padding.
  - `TabBar` (Home, Find, Alerts, Account).
  - `WebNav({ active })`

- [ ] **Step 1: Write the failing RNTL tests:**
  - A disabled `Button` doesn't call `onPress`, and it exposes `accessibilityState.disabled` true.
  - `Button` `variant="urgent"` uses the `deepBlue` background.
  - `Card role="tip" title="Face, side and markings"` renders the title with colour `#1C7055`.
  - `Chip kind="missing"` renders "Missing" with `softYellow` background.
  - `Field` with an `error` exposes the error text as an accessibility hint.
  - `StepDots count={3} current={1}` renders 3 dots with the second 20 wide.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement the primitives.** Gradients and glows use `expo-linear-gradient` and absolutely positioned blurred views (`expo-blur` on native, CSS `filter: blur()` on web).
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** — `feat(ui): primitives mirroring the component library`

---

### Task 14: Stickers and pet portraits

**Files:**
- Create: `tools/stickers/export_svgs.py`, `packages/ui/assets/stickers/*.svg` (14 files, generated), `packages/ui/src/stickers/generated/*.tsx` (via `pnpm dlx @svgr/cli --native --typescript --out-dir …`), `src/stickers/names.ts`, `src/stickers/Sticker.tsx`, `src/stickers/PetPortrait.tsx`
- Test: `packages/ui/src/stickers/stickers.test.tsx`

**Interfaces:**
- Consumes: `tools/stickers/stickers.py` (`STICKERS` list of `(name, fn, usage)`; each `fn()` returns JSX-flavoured markup whose inner `<path …/>` elements are standard SVG).
- Produces:
  - `STICKER_NAMES = ['dog','cat','sleepy-moon','cloud','paw-star','sparkle','heart-paw','meoofy','privacy-shield','love-letter','pet-tag','shooting-star','rainbow','bone'] as const` and `type StickerName`.
  - `Sticker({ name: StickerName, size?: number = 64, rotate?: number = 0 })`: always hidden from accessibility.
  - `PetPortrait({ species: Species, flow: Flow, width: number, height: number, label?: string })`: diagonal flow gradient, white halo, dog or cat sticker at `0.6 × height` (`0.72` when height < 160), one sparkle, optional label pill.

- [ ] **Step 1: Write the failing tests:**
  - Each of the 14 names renders without throwing.
  - `Sticker` has `accessibilityElementsHidden === true` and `importantForAccessibility === 'no-hide-descendants'`.
  - `rotate={-8}` sets `transform: [{ rotate: '-8deg' }]`.
  - `PetPortrait species="cat" label="Luna photo"` renders the label text and a `cat` sticker.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement the generator.** `export_svgs.py` extracts the inner markup from `svg(...)` output and wraps it as `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">`. It inserts a shadow copy of the first (die-cut outline) path, with `fill="#53749A" fill-opacity="0.18" stroke="none" transform="translate(0 6)"`, before the outline. It writes `<kebab-name>.svg`. Then run svgr. `Sticker` maps names to the generated components.
- [ ] **Step 4: Run `python3 tools/stickers/export_svgs.py && pnpm gen:stickers && pnpm --filter @meoofy/ui test` and confirm it passes.**
- [ ] **Step 5: Commit** — `feat(ui): die-cut sticker components and pet portraits`

---

### Task 15: Motion presets with Reduce Motion

**Files:**
- Create: `packages/ui/src/motion/presets.ts`, `resolveMotion.ts`, `useMotionPreference.ts`, `Peel.tsx`, `Float.tsx`, `Twinkle.tsx`, `Confetti.tsx`
- Test: `packages/ui/src/motion/resolveMotion.test.ts`, `motion.test.tsx`

**Interfaces:**
- Consumes: `motion` tokens.
- Produces:
  - `type MotionPreset = 'peel' | 'float' | 'twinkle' | 'pawTrail' | 'moonrise' | 'confetti'`
  - `resolveMotion(preset: MotionPreset, reduced: boolean): { kind: 'timing' | 'loop' | 'fade' | 'none'; duration: number; easing: [number, number, number, number]; loop: boolean }`
  - `useMotionPreference(): { reduced: boolean }`, which wraps Reanimated `useReducedMotion`.
  - Components `Peel({ children, delay? })`, `Float({ children, index })` (stagger = `index × 400` ms), `Twinkle({ children })`, `Confetti({ active })`.

- [ ] **Step 1: Write the failing tests:**

```ts
expect(resolveMotion('peel', false)).toEqual({ kind: 'timing', duration: 420, easing: [0.34, 1.56, 0.64, 1], loop: false })
expect(resolveMotion('float', false)).toMatchObject({ kind: 'loop', duration: 3200, loop: true })
expect(resolveMotion('float', true)).toMatchObject({ kind: 'none', loop: false })
expect(resolveMotion('peel', true)).toEqual({ kind: 'fade', duration: 160, easing: [0.2, 0.8, 0.2, 1], loop: false })
expect(resolveMotion('confetti', true)).toMatchObject({ kind: 'none' })
expect(resolveMotion('moonrise', false)).toMatchObject({ duration: 360, easing: [0.2, 0.8, 0.2, 1] })
```

  Component test: with `useReducedMotion` mocked to true, `Float` renders its children statically (no animated transform style).
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.** The presets map to the spec §8 values. The components use Reanimated `withTiming` / `withRepeat` driven by `resolveMotion`.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** — `feat(ui): motion presets honouring Reduce Motion`

---

### Task 16: Expo app shell, routing, layout and providers

**Files:**
- Create: `apps/app` (via `pnpm create expo-app@latest apps/app --template tabs`, then trim), `app.config.ts`, `src/env.ts`, `src/navigation/entry.ts`, `src/layout/layoutMode.ts`, `src/storage/local.ts`, `src/state/SessionProvider.tsx`, `src/state/QueryProvider.tsx`, `app/_layout.tsx`, `app/(tabs)/_layout.tsx`, `app/(tabs)/find.tsx`, `app/(tabs)/alerts.tsx`, `src/features/placeholders/{PlaceholderScreen.tsx,copy.ts}`
- Test: `apps/app/src/navigation/entry.test.ts`, `src/layout/layoutMode.test.ts`, `src/features/placeholders/placeholder.test.tsx`

**Interfaces:**
- Consumes: `createMeoofyClient`, `getProfile` (api); `ScreenShell`, `TabBar`, `WebNav` (ui).
- Produces:
  - `env = { supabaseUrl: string; supabaseAnonKey: string; sentryDsn: string | null; e2e: boolean; flags: { reportMissing: false } }`, read from `EXPO_PUBLIC_*`.
  - `local`: `get/set/remove` for keys `meoofy.onboardingSeen`, `meoofy.onboardingPath`, `meoofy.petDraft` (AsyncStorage).
  - `resolveEntryRoute(s: { onboardingSeen: boolean; signedIn: boolean; displayName: string | null; pendingOnboardingPath: OnboardingPath | null }): '/(onboarding)/welcome' | '/(auth)/sign-in' | '/(auth)/your-name' | '/(tabs)/home' | '/(tabs)/find'`. A signed-in, named user whose pending path is `finder` lands on Find.
  - `layoutModeFor(width: number): 'mobile' | 'mobile-centered' | 'desktop'`
  - `SessionProvider` exposing `useSession(): { client: MeoofyClient; signedIn: boolean; userId: string | null }`. The session persists with `expo-secure-store` on iOS and the default on web.
  - `QueryProvider`: TanStack Query with persistence (AsyncStorage persister on native, `localStorage` on web) and the retry policy `retry: (n, e) => n < 3 && parseAppError(e).retryable`.
  - Inter fonts loaded in the root layout.
  - Desktop mode renders `WebNav`; other modes render `TabBar`.

- [ ] **Step 1: Write the failing tests:**

```ts
expect(resolveEntryRoute({ onboardingSeen: false, signedIn: false, displayName: null, pendingOnboardingPath: null })).toBe('/(onboarding)/welcome')
it('signed-out state routes to sign-in', () => expect(resolveEntryRoute({ onboardingSeen: true, signedIn: false, displayName: null, pendingOnboardingPath: 'owner' })).toBe('/(auth)/sign-in'))
expect(resolveEntryRoute({ onboardingSeen: true, signedIn: true, displayName: '', pendingOnboardingPath: null })).toBe('/(auth)/your-name')
expect(resolveEntryRoute({ onboardingSeen: true, signedIn: true, displayName: 'Alex', pendingOnboardingPath: null })).toBe('/(tabs)/home')
expect(resolveEntryRoute({ onboardingSeen: true, signedIn: true, displayName: 'Alex', pendingOnboardingPath: 'finder' })).toBe('/(tabs)/find')
expect(layoutModeFor(767)).toBe('mobile'); expect(layoutModeFor(768)).toBe('mobile-centered'); expect(layoutModeFor(1023)).toBe('mobile-centered'); expect(layoutModeFor(1024)).toBe('desktop')
```

  Placeholder test: the Find tab renders the copy "Scanning arrives in the next pilot build" and a `finder`-tinted `ScreenShell`.
- [ ] **Step 2: Run `pnpm --filter @meoofy/app test` and confirm it fails.**
- [ ] **Step 3: Implement the shell and modules.**
- [ ] **Step 4: Run the tests and confirm they pass. Then run `pnpm --filter @meoofy/app exec expo start --web` and check that the Find tab renders at 390 px and 1440 px.**
- [ ] **Step 5: Commit** — `feat(app): Expo shell, entry routing, layout modes and providers`

---

### Task 17: Onboarding screens (O00–O03)

**Files:**
- Create: `apps/app/app/(onboarding)/{_layout,welcome,choose-path,privacy,all-set}.tsx`, `src/features/onboarding/{copy.ts,WelcomeScreen.tsx,ChoosePathScreen.tsx,PrivacyScreen.tsx,AllSetScreen.tsx,heroes.tsx}`
- Test: `apps/app/src/features/onboarding/onboarding.test.tsx`

**Interfaces:**
- Consumes: `local`, `Sticker`, `Peel`, `Float`, `Confetti`, primitives, `completeOnboarding` via `useProfile` (Task 19 defines the hook; until then call `completeOnboarding` from `@meoofy/api` through `useSession().client`).
- Produces: completing O02 sets `meoofy.onboardingSeen = 'true'`. Choosing a card in O01 stores `meoofy.onboardingPath`. The finder path then routes to `/(tabs)/find` after sign-in. After the first sign-in, the app calls `completeOnboarding(storedPath)` once and removes the key.

- [ ] **Step 1: Write the failing tests:**
  - O00 renders "Every pet deserves a way home." and the buttons "Get started" and "I found a pet".
  - Choosing "Help a found pet" then "Continue" stores `meoofy.onboardingPath = 'finder'`.
  - "Protect my pet" is selected by default and has `accessibilityState.selected` true.
  - O02 lists the three promises exactly: "Owners choose what finders see.", "Contact stays inside Meoofy.", "No account needed to scan."
  - O03 renders "You’re all set, {name}." with the profile name.
  - Hero stickers are hidden from accessibility.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement the screens to match board 08.**
  - Hero compositions: Night garden (dog, cat, sleepy moon), Two paths (dog, meoofy, heart paw), Safe orbit (privacy shield, love letter, sleepy moon), Celebration (rainbow, pet tag, shooting star, heart paw + confetti).
  - Layout: status/top bar 48+48, hero 268, copy block 128, and actions 48+48 pinned to the bottom.
  - Steps O00 → O01 → O02 use the `moonrise` transition from Task 15.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** — `feat(app): onboarding flow O00–O03`

---

### Task 18: Sign-in, email code and name screens

**Files:**
- Create: `apps/app/app/(auth)/{_layout,sign-in,email-code,your-name}.tsx`, `src/features/auth/{copy.ts,SignInScreen.tsx,EmailCodeScreen.tsx,YourNameScreen.tsx,appleNonce.ts}`
- Test: `apps/app/src/features/auth/auth.test.tsx`, `appleNonce.test.ts`

**Interfaces:**
- Consumes: `sendEmailCode`, `verifyEmailCode`, `signInWithAppleIdToken`, `updateDisplayName`, `parseAppError`; `expo-apple-authentication` on iOS; Supabase OAuth redirect (`signInWithOAuth({ provider: 'apple' })`) on web, through a `signInWithAppleWeb(c)` helper added to `packages/api/src/auth.ts`.
- Produces: `createNonce(): Promise<{ raw: string; hashed: string }>`, where `hashed` is the SHA-256 hex of `raw` (expo-crypto).

- [ ] **Step 1: Write the failing tests:**
  - Submitting an invalid email shows "Enter a valid email address" and makes no API call.
  - A valid email calls `sendEmailCode` and navigates to email-code.
  - Entering 6 digits calls `verifyEmailCode`.
  - `UNAUTHENTICATED` shows the S05 copy "That code didn’t work" with "Send a new code" enabled.
  - `INVITE_ONLY` shows "This pilot is invite-only".
  - Apple cancel (`ERR_REQUEST_CANCELED`) shows no error.
  - The your-name screen rejects whitespace and saves "Alex".
  - `createNonce().hashed` is 64 hex characters and differs between calls.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement the screens (O01 owner welcome layout, F08-style code entry with a resend countdown of 30 s).**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** — `feat(app): Apple and email-code sign-in with name step`

---

### Task 19: Home, Plans and Account

**Files:**
- Create: `apps/app/app/(tabs)/home.tsx`, `app/(tabs)/account.tsx`, `app/plans.tsx`, `src/data/{usePets.ts,useEntitlement.ts,useProfile.ts}`, `src/features/home/{copy.ts,HomeScreen.tsx,PetRow.tsx}`, `src/features/plans/{copy.ts,PlansScreen.tsx}`, `src/features/account/{copy.ts,AccountScreen.tsx}`
- Test: `apps/app/src/features/home/home.test.tsx`, `src/features/plans/plans.test.tsx`, `src/features/account/account.test.tsx`

**Interfaces:**
- Consumes: `listPets`, `getEntitlement`, `getProfile`, `deleteAccount`, `signOut`; `PetPortrait`, `Card`, `Chip`.
- Produces:
  - `usePets(): UseQueryResult<Pet[]>` (key `['pets']`)
  - `useEntitlement()` (key `['entitlement']`)
  - `useProfile()` (key `['profile']`)

- [ ] **Step 1: Write the failing tests:**
  - With 2 pets on free, Home shows "Hello, Alex", the pet names, the chip "Private" and "2 of 3 · Free".
  - With 0 pets, it shows S01 "Your circle starts here" and "Add my first pet".
  - With 3 pets on free, "Add a pet" navigates to `/plans` instead of `/pets/new`.
  - Plans shows Free 3, Pro 10 and Max "Unlimited". Upgrade buttons are disabled with label "Coming soon".
  - Account → "Delete account" opens a confirmation. Confirming calls `deleteAccount`, clears the query cache and routes to `/(auth)/sign-in`.
  - "Sign out" calls `signOut`.
  - Account shows the name and email. "Edit name" opens `/(auth)/your-name?mode=edit` prefilled with "Alex", and saving "Al" calls `updateDisplayName('Al')` and returns to Account.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement (owner flow tint; desktop renders the two-column W06 layout).**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** — `feat(app): home, plans and account screens`

---

### Task 20: Add pet and pet profile

**Files:**
- Create: `apps/app/app/pets/new.tsx`, `app/pets/[id]/index.tsx`, `src/data/{usePet.ts,useCreatePet.ts,useUpdatePet.ts,useDeletePet.ts}`, `src/features/pets/{copy.ts,AddPetScreen.tsx,PetProfileScreen.tsx,AgeInput.tsx}`
- Test: `apps/app/src/features/pets/pets.test.tsx`

**Interfaces:**
- Consumes: `createPet`, `getPet`, `updatePet`, `deletePet`, `petInputSchema`, `toAgeMonths`, `formatAge`, `env.flags.reportMissing`; the draft API from Task 22 (`saveDraft`/`loadDraft`/`clearDraft`). Until Task 22 lands, wire the "Save as draft" button to a no-op `saveDraft` stub that Task 22 replaces.
- Produces: `useCreatePet()` generates the pet id once per form mount (`crypto.randomUUID()`), so retries are idempotent. On success it invalidates `['pets']` and `['entitlement']`.

- [ ] **Step 1: Write the failing tests:**
  - Submitting with an empty name shows "Give your pet a name" and makes no API call.
  - Years "31" shows "Age must be 30 years or less".
  - A valid submit calls `createPet` with `{ name: 'Milo', species: 'dog', breed: 'Golden retriever', ageMonths: 36 }` and an id that is stable across a retry.
  - `PET_LIMIT_REACHED` shows a `community` card explaining the Free 3-pet limit with a "Compare plans" link.
  - The profile shows "Milo", "Golden retriever · 3 years", "Discovery Off" and "Milo is not searchable."
  - "Report Milo missing" is not rendered while `flags.reportMissing` is false.
  - "Edit" on the profile opens the form prefilled (name "Milo", years "3"). Changing the breed to "" and saving calls `updatePet(id, { breed: null })`.
  - "Delete pet" asks for confirmation, then calls `deletePet` and routes Home.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement to match O03 and O05.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** — `feat(app): add pet and private pet profile`

---

### Task 21: Reference photo capture and upload

**Files:**
- Create: `apps/app/app/pets/[id]/photos.tsx`, `src/photo/preparePhoto.ts`, `src/data/usePhotoUpload.ts`, `src/features/photos/{copy.ts,PhotoCaptureScreen.tsx,ViewTile.tsx,CameraSheet.tsx}`
- Test: `apps/app/src/photo/preparePhoto.test.ts`, `src/features/photos/photos.test.tsx`

**Interfaces:**
- Consumes: `analyzeGray`, `assessPhoto`, `LIMITS`, `uploadPhoto`, `listPhotos`; `expo-camera`, `expo-image-picker`, `expo-image-manipulator`, `jpeg-js`.
- Produces:
  - `preparePhoto(uri: string, deps?: { manipulate?; decode? }): Promise<{ ok: true; jpeg: ArrayBuffer; width: number; height: number; brightness: number; blurScore: number } | { ok: false; reason: 'TOO_SMALL' | 'TOO_DARK' | 'TOO_BRIGHT' | 'BLURRY' | 'TOO_LARGE' }>`. It:
    1. resizes to 1600 long edge, JPEG 0.8;
    2. makes a 512 px copy and decodes it with `jpeg-js`;
    3. converts to grayscale (`0.299R + 0.587G + 0.114B`);
    4. runs `analyzeGray` then `assessPhoto`;
    5. fails `TOO_LARGE` if the encoded size is over 4 194 304 bytes.
  - `usePhotoUpload(petId)` returns `{ upload(view: PhotoView, uri: string): Promise<void>; state: Record<PhotoView, 'idle' | 'checking' | 'uploading' | 'ready' | 'error'> }`.

- [ ] **Step 1: Write the failing tests:**
  - `preparePhoto` with injected fakes returns `{ ok: false, reason: 'BLURRY' }` for a flat gray decode, and `ok: true` for a checker-pattern decode at 1600×1200.
  - Front, side and markings tiles render with the O04 copy "Use daylight. Keep the face and coat visible. Avoid filters and blurry photos."
  - When camera permission is denied, the S02 card "Camera access is off" appears with "Upload photos instead", which opens the image picker.
  - A `BLURRY` result shows "That photo looks blurry — try again in better light" and keeps the previous ready photo.
  - When `env.e2e` is true, a "Use test photo" button appears. When false (production), it is absent.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement the screen to match O04** (selected tile style per the Front tile, ready tiles show a thumbnail via signed URL, owner flow tint).
- [ ] **Step 4: Run the tests and confirm they pass. Then try one real capture on the iOS Simulator with a library image.**
- [ ] **Step 5: Commit** — `feat(app): guided reference photo capture with quality checks`

---

### Task 22: Offline behaviour and drafts

**Files:**
- Create: `apps/app/src/offline/useOnline.ts` (NetInfo), `src/offline/draft.ts`, `src/offline/OfflineBanner.tsx`
- Modify: `src/features/home/HomeScreen.tsx`, `src/features/pets/AddPetScreen.tsx`, `src/features/photos/PhotoCaptureScreen.tsx`, `src/state/QueryProvider.tsx` (persist `['pets']`, `['entitlement']`, `['profile']` only)
- Test: `apps/app/src/offline/offline.test.tsx`

**Interfaces:**
- Consumes: `local` (`meoofy.petDraft`).
- Produces:
  - `useOnline(): boolean`
  - `saveDraft(d: Partial<{ name: string; species: Species; breed: string; years: string; months: string }>): Promise<void>`
  - `loadDraft(): Promise<… | null>`
  - `clearDraft(): Promise<void>`
  - `OfflineBanner` with copy "You’re offline. Saved information is available."

- [ ] **Step 1: Write the failing tests:**
  - `renders cached pets offline`: with a hydrated persisted cache and NetInfo reporting offline, Home shows the cached names and the offline banner, and "Add a pet" shows "Save as draft" as the primary action.
  - `restores draft after restart`: `saveDraft({ name: 'Milo' })`, unmount and remount the Add pet screen, and the name field reads "Milo". A successful create calls `clearDraft`.
  - Photo actions are disabled offline with "Photos need a connection".
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement (replacing Task 20's draft stub).**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** — `feat(app): offline cache, banner and add-pet drafts`

---

### Task 23: Error reporting with personal-data scrubbing

**Files:**
- Create: `apps/app/src/observability/sentry.ts`
- Modify: `app/_layout.tsx` (initialise only when `env.sentryDsn`), `app.config.ts` (Sentry plugin)
- Test: `apps/app/src/observability/sentry.test.ts`

**Interfaces:**
- Produces:
  - `scrubEvent<E extends { user?: object; request?: object; message?: string; exception?: { values?: { value?: string }[] } }>(event: E): E`. It deletes `user` except `id`, deletes `request`, replaces emails with `[email]`, and replaces UUID path pairs matching `/[0-9a-f-]{36}\/[0-9a-f-]{36}(\/[0-9a-f-]{36}\.jpg)?/` with `[path]`.
  - `initSentry(dsn: string): void`, using `sendDefaultPii: false` and `beforeSend: scrubEvent`.

- [ ] **Step 1: Write the failing tests:**
  - `scrubEvent({ user: { id: 'u1', email: 'a@b.co' }, message: 'failed for a@b.co' })` → `{ user: { id: 'u1' }, message: 'failed for [email]' }`.
  - A storage path inside `exception.values[0].value` becomes `[path]`.
  - `request` is removed.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** — `feat(app): Sentry reporting with PII scrubbing`

---

### Task 24: End-to-end tests (iOS and web)

**Files:**
- Create: `tools/fixtures/make-photo-fixtures.ts` (uses `makeTestJpeg` from `packages/api/test/helpers.ts` to write `apps/app/e2e/fixtures/{front,side,markings}.jpg` at 1600×1200 with seeds 1/2/3, plus a flat-gray `blurry.jpg`), `apps/app/e2e/support/mailpit.ts`, `apps/app/e2e/maestro/registry-happy-path.yaml`, `apps/app/e2e/web/registry.spec.ts`, `apps/app/playwright.config.ts` (projects `mobile-390` 390×844 and `desktop-1440` 1440×1000)
- Modify: root `package.json` (`test:e2e:web`, `test:e2e:ios`; root `verify` runs `test:e2e:web`; `test:e2e:ios` runs in Task 25's CI notes and before each TestFlight build)

**Interfaces:**
- Consumes: the `env.e2e` "Use test photo" seam (Task 21), which loads the bundled fixtures. `e2e@meoofy.test` comes from the seed allowlist (Task 8).
- Produces: `latestCode(email: string): Promise<string>`, which polls Mailpit for up to 10 s and returns the 6-digit code.

- [ ] **Step 1: Write the Playwright spec `registry.spec.ts`** covering the steps below, and the matching Maestro flow:
  1. Onboarding → "Get started" → "Continue" → "Sounds good".
  2. Email `e2e+<timestamp>@meoofy.test`. The test inserts that address into the allowlist via the service role in `beforeAll`.
  3. Code from Mailpit → name "Alex" → all set → Home shows "Your circle starts here".
  4. Add pet Milo (dog, Golden retriever, 3 years) → photos: front/side/markings via "Use test photo" → three ready tiles.
  5. Profile shows "Discovery Off".
  6. Delete pet → Home empty.
- [ ] **Step 2: Run `pnpm db:reset && pnpm test:e2e:web` and confirm it fails at the first missing element** (it passes once all earlier tasks are in).
- [ ] **Step 3: Implement the fixture generator and the Mailpit helper, and fix any selector gaps by adding `testID`s in the screens (no behaviour changes).**
- [ ] **Step 4: Run `pnpm test:e2e:web` (both projects) and `pnpm test:e2e:ios` (`maestro test apps/app/e2e/maestro` against a development build on the iOS 26 simulator) and confirm both pass.**
- [ ] **Step 5: Visual review.** Add a Playwright step that saves `page.screenshot` for every in-scope screen at 390 and 1440 px into `apps/app/e2e/screenshots/` (git-ignored). Compare each screen against its Figma frame (08 O00–O03, 01 O01–O05, 05 S01/S02/S04/S05, 07 W06) for layout, colour roles and stickers. Fix differences in the screen code, then re-run Step 4.
- [ ] **Step 6: Commit** — `test(e2e): registry happy path on iOS and web`

---

### Task 25: Delivery: EAS, hosting, CI and owner setup wizard

**Files:**
- Create: `apps/app/eas.json` (profiles: `development` with `developmentClient: true` and `EXPO_PUBLIC_E2E=1`; `preview` internal; `production` with `autoIncrement: true` and **no** `EXPO_PUBLIC_E2E`), `.github/workflows/verify.yml` (ubuntu: setup pnpm 11 + Node 24 + Deno, `supabase start`, `pnpm verify`), `tools/setup/pilot-setup.sh` (generated with the `wizard` skill), `README.md` (local dev, verify, deploy commands)
- Modify: `apps/app/app.config.ts` (`ios.bundleIdentifier: 'com.meoofy.pilot'`, `ios.usesAppleSignIn: true`, camera/photo-library usage strings, `web.output: 'static'`)
- Test: `apps/app/src/config.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `pnpm deploy:web` = `expo export --platform web && eas deploy --prod`
  - `pnpm build:ios` = `eas build -p ios --profile production`
  - `pnpm submit:ios` = `eas submit -p ios --latest`
  - `pnpm db:push` = `supabase db push && supabase functions deploy delete-account storage-cleanup`
  - The wizard walks the owner through:
    1. Apple Developer enrolment.
    2. Choosing or confirming the bundle id.
    3. App Store Connect app record.
    4. Sign in with Apple service ID and key.
    5. Supabase project creation, Apple provider keys, vault secrets `project_url` and `service_role_key`, and the auth hook enabled in the dashboard.
    6. EAS login and env vars `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` / `EXPO_PUBLIC_SENTRY_DSN`.
    7. Sentry project.
    8. Supabase spend cap and usage alerts set (budget target US$200/month).
    9. Tester emails added to `identity.pilot_allowlist`.

- [ ] **Step 1: Write the failing test `config.test.ts`:**
  - Loading `eas.json` gives `build.production.env.EXPO_PUBLIC_E2E` undefined.
  - `app.config.ts` resolves `ios.bundleIdentifier === 'com.meoofy.pilot'`, `ios.usesAppleSignIn === true`, and a non-empty `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription`.
- [ ] **Step 2: Run `pnpm --filter @meoofy/app test config` and confirm it fails.**
- [ ] **Step 3: Implement the config, the workflow, the wizard (invoke the `wizard` skill with the step list above) and the README.**
- [ ] **Step 4: Run `pnpm verify` and confirm it passes end to end. Then run `bash -n tools/setup/pilot-setup.sh` and confirm the wizard parses.**
- [ ] **Step 5: Commit** — `chore(delivery): EAS profiles, CI workflow, setup wizard and README`

---

## Spec coverage map

| Spec section | Tasks |
|---|---|
| §1 success criteria | 10, 11, 24, 25 (verify, TestFlight/web paths) |
| §2 scope screens | 16–22 |
| §3 decisions | 1, 4, 10, 16, 25 |
| §4 architecture and dependency rules | 1, 10, 16 |
| §5 data model | 4, 5, 8, 9 |
| §6 functions, storage, errors, auth hook | 5–9, 3 |
| §7 photo pipeline | 3, 7, 9, 11, 21 |
| §8 client (routes, design system, motion, data layer, accessibility) | 12–22 |
| §9 error and offline table | 3, 18, 20, 21, 22 |
| §10 security, privacy, cost | 4–9, 23 |
| §11 testing | every task; 24 end-to-end |
| §12 environments and delivery | 4, 9, 25 |
