# PawPin — Sub-project 1: App Foundation and Private Registry

**Date:** 2026-10-23
**Status:** Draft for review
**Parent product spec:** [`docs/product/pawpin-design-spec.md`](../../product/pawpin-design-spec.md)
**Design source:** `../outputs/pawpin-ui-ux.fig` (OpenPencil). Boards 00 (library), 08 (onboarding), 01 (owner registration), 05 (resilience), 06/07 (web), 09 (stickers) and 10 (motion).

## 1. Intent and success criteria

PawPin's first build puts the designed experience into a real app. Owners can sign up and privately register their dogs and cats with reference photos on iOS and the web. This is the foundation every later sub-project builds on: recovery, finder scan, alerts and messaging.

This sub-project is done when all of these are true:

- Invited testers can install the iOS build from TestFlight and use the web build at a hosted URL.
- A tester can complete onboarding and sign in with Apple or a 6-digit email code. They can then add up to three pets with name, species, breed/description, approximate age and three reference photos (front, side, markings), view and edit them, delete a pet and delete their account.
- No user can read or change another user's pets, photos or files. Database tests prove this.
- The Free tier's 3-pet limit is enforced on the server, including when two requests race.
- Every state change writes an audit event.
- The app matches the Figma boards for the screens in scope: tokens, typography, stickers, motion and colour roles. It respects Reduce Motion.
- `pnpm verify` passes: typecheck, lint, unit, database, integration and end-to-end tests.

## 2. Scope

### In scope

| Area | Screens (Figma frame) |
|---|---|
| Onboarding | O00 Welcome, O01 Choose your path, O02 Private by default, O03 All set (board 08) |
| Sign-in | O01 Welcome with "Continue with Apple" and "Sign in with email"; email code entry; expired-code state S05 |
| Profile name | One "What should we call you?" step for email sign-ups. Apple sign-ups use the given first name and can edit it. |
| Home | O02 Hello + pet list + "2 of 3 · Free" + Add a pet; S01 empty registry |
| Add pet | O03 Let's meet your pet: name, species (dog or cat), breed/description, and approximate age as years (0–30) plus optional months, stored as `age_months`. Includes Save as draft. |
| Reference photos | O04 A clearer photo helps (front, side, markings); S02 camera denied with library fallback |
| Pet profile | O05 Milo: private chip, Discovery Off explanation, edit, delete. "Report missing" exists behind a disabled feature flag. |
| Plans | W06 "Free · 2 of 3 pets" card and a Compare plans screen (Free / Pro / Max). Upgrade buttons show "Coming soon". |
| Account | Name, email, sign out, delete account |
| Placeholders | Find and Alerts tabs: friendly "coming in a later pilot build" screens. Finder path chosen in O01 leads to the same Find placeholder. |
| Offline | S04: last-known data read-only, offline banner, local draft for add-pet basics |
| Web | All of the above, responsive. Under 768px: the mobile layout. From 1024px: the two-column W06 dashboard with top navigation. |

### Out of scope (later sub-projects)

Missing reports and Discovery Mode, the finder scan and photo matching, nearby alerts and push notifications, messaging, real purchases (StoreKit or web checkout), data export, operator/admin tooling, Android-native builds, and localisation beyond English.

## 3. Decisions

| Decision | Choice | Reason |
|---|---|---|
| Architecture | Expo universal app plus a thin Supabase backend | One codebase for iOS and web, as the product spec requires. Least code and ops for a solo builder. |
| Backend | Supabase: Postgres, Auth, Storage, Edge Functions, Cron | User preference. Relational, as the product spec requires. Fits the US$200/month target. |
| Sign-in | Sign in with Apple plus a 6-digit email one-time code | Matches the O01 and F08 designs. No passwords to store or reset. |
| Tiers | Server-enforced limits, no purchases | Limit logic exists from day one. Billing waits for the operations phase. |
| Repository | `/Users/rockycelis/Documents/Codex/2026-10-23/i/pawpin`, pnpm workspace | Next to the designs. pnpm runs with hoisted `node_modules` for Expo compatibility. |
| Web hosting | EAS Hosting (static export) | Same vendor as the iOS builds. No extra platform. |

## 4. Architecture

```
pawpin/
├─ apps/app/              Expo Router app (iOS + web)
├─ packages/ui/           tokens, primitives, stickers, motion
├─ packages/core/         domain types, validation, tier rules, error codes (pure, no I/O)
├─ packages/api/          typed Supabase client: auth, pets, photos, entitlements
├─ supabase/              config, migrations, seed, pgTAP tests, Edge Functions
└─ docs/                  product spec, superpowers specs and plans
```

Dependency direction: `apps/app → packages/api → packages/core`, and `apps/app → packages/ui`. `packages/core` depends on nothing internal. Screens never import supabase-js. They use hooks in `apps/app/src/data/` that wrap `packages/api` with TanStack Query.

Request flow:

1. **Reads:** the app queries tables or views through supabase-js. Row-level security returns only the caller's rows.
2. **Writes:** the app calls Postgres functions (RPC) or Edge Functions. Clients have no insert, update or delete policies on any table.
3. **Files:** the app asks the server for an upload slot, uploads to the private bucket, then confirms. It displays photos through signed URLs that expire after one hour.

Each backend module owns a Postgres schema: `identity`, `registry`, `entitlements`, `audit`. Client-callable functions live in the `api` schema, which is the only schema exposed to clients.

## 5. Data model

**`identity.profiles`**: `id` (= `auth.users.id`, PK), `display_name` text (1–40), `onboarding_path` enum `owner | finder`, `onboarding_completed_at` timestamptz, `created_at`. Created by a trigger when an auth user is created.

**`registry.pets`**: `id` uuid PK (client-generated), `owner_id` → `auth.users` (cascade delete), `name` text (1–40), `species` enum `dog | cat`, `breed` text null (≤ 80), `age_months` int null (0–360), `registration_state` enum `private | archived` default `private`, `discovery_enabled` boolean default false, `created_at`, `updated_at`.

**`registry.pet_photos`**: `id` uuid PK (client-generated), `pet_id` → `registry.pets` (cascade), `owner_id`, `view` enum `front | side | markings | extra`, `storage_path` text unique, `width` int, `height` int, `bytes` int, `blur_score` real, `brightness` real, `status` enum `pending | ready | rejected`, `created_at`, `confirmed_at`. At most 6 non-rejected photos per pet. At most one `ready` photo per required view (front, side, markings); a new photo for a view replaces the old one.

**`registry.storage_deletions`**: `id`, `storage_path`, `requested_at`, `attempts`, `last_error`. This is the queue drained by the cleanup job.

**`entitlements.accounts`**: `owner_id` PK, `tier` enum `free | pro | max` default `free`, `updated_at`. Created by the auth-user trigger. The pet limit comes from `packages/core` and the SQL function `entitlements.pet_limit(tier)`: free 3, pro 10, max null (unlimited).

**`audit.events`**: `id` bigserial, `actor_id` uuid null, `action` text, `subject_type` text, `subject_id` uuid null, `metadata` jsonb (never names, emails, coordinates or file paths), `created_at`. Append-only: no update or delete grants to any client role.

**`identity.pilot_allowlist`**: `email` citext PK, `invited_at`. Only service-role access.

## 6. Authorization and server functions

Row-level security is enabled on every table. Select policies: `owner_id = auth.uid()` (`id = auth.uid()` for profiles). Clients have no write policies.

Client-callable functions are `security definer` with a fixed `search_path`. Each one checks the following in order: the caller is authenticated, the caller owns the subject, the input is valid. Each then writes one audit event. Validation rules match `packages/core` exactly. The same constants are emitted to SQL by a generation script.

| Function | Rules | Errors |
|---|---|---|
| `api.complete_onboarding(path)` | Sets the onboarding path and completion time. Idempotent. Onboarding happens before sign-in, so the app keeps the chosen path on the device and calls this right after the first sign-in. | `UNAUTHENTICATED` |
| `api.update_profile(display_name)` | 1–40 characters after trimming | `VALIDATION` |
| `api.create_pet(id, name, species, breed, age_months)` | Locks the caller's entitlement row (`for update`). Counts `private` pets. Rejects at the limit. If `id` already exists for this owner, returns it unchanged. | `PET_LIMIT_REACHED`, `VALIDATION` |
| `api.update_pet(id, fields…)` | Owner only. Same validation. | `NOT_OWNER`, `VALIDATION` |
| `api.delete_pet(id)` | Owner only. Queues all of the pet's storage paths, then deletes the rows. | `NOT_OWNER` |
| `api.request_photo_upload(id, pet_id, view, content_type, bytes)` | Owner only. JPEG only. `bytes ≤ 4 MB`. Under 6 photos. Max 30 requests per user per rolling hour. Creates a `pending` row with path `{owner_id}/{pet_id}/{id}.jpg`. | `NOT_OWNER`, `VALIDATION`, `RATE_LIMITED` |
| `api.confirm_photo(id, width, height, blur_score, brightness)` | Owner only. The object exists in storage at the row's path. Short side ≥ 720. Marks the row `ready` and queues any replaced photo of the same view for deletion. | `NOT_OWNER`, `PHOTO_QUALITY` |
| `api.delete_photo(id)` | Owner only. Queues the file and deletes the row. | `NOT_OWNER` |
| Edge Function `delete-account` | Verifies the caller's JWT. Removes every object under `{owner_id}/`. Writes `account.deleted` with `actor_id` null. Deletes the auth user; rows cascade. | `UNAUTHENTICATED` |
| Auth hook `before-user-created` | Rejects sign-ups whose email is not in `identity.pilot_allowlist`, and logs the rejected address. Apple "Hide My Email" relay addresses can't be known in advance, so an invited tester using one is rejected once. The operator copies the relay address from the hook log into the allowlist, and the tester signs in again. | Shown as "This pilot is invite-only" |

Storage: one private bucket, `pet-photos`.
- **Insert policy:** the path starts with `auth.uid()/` and matches a `pending` row owned by the caller.
- **Select policy:** the path starts with `auth.uid()/`.
- **Update and delete:** no client policies. Deletion happens only through the cleanup job or the `delete-account` function, using the service role.

Errors reach clients as Postgres exceptions with a stable `PAWPIN:<CODE>` message prefix. `packages/api` parses them into a typed `AppError { code, retryable }`.

## 7. Reference photo pipeline

1. **Capture:** the user takes a photo with the camera (`expo-camera`, guided frame per view) or picks one from the library (`expo-image-picker`). The library fallback is the S02 path when camera permission is denied.
2. **On-device preparation:** the app resizes so the long edge is 1600px, encodes JPEG at quality 0.8, and computes two checks on a 512px grayscale copy:
   - mean brightness, which must be 40–220 on a 0–255 scale;
   - Laplacian variance as a blur score, which must be ≥ 80.
   Failures show the O04 guidance ("Use daylight… avoid filters and blurry photos") and offer a retake. The thresholds are constants in `packages/core`, tuned during the pilot.
3. **Upload:** `request_photo_upload`, then a storage upload to the returned path, then `confirm_photo`.
4. **Display:** signed URLs (1 hour), cached by the image component.
5. **Cleanup:** a Supabase Cron job runs an Edge Function every 5 minutes. It deletes the objects queued in `registry.storage_deletions`. It also queues `pending` photos older than 24 hours and storage objects that have no row.

Species detection, face detection and matching representations belong to the matching sub-project.

## 8. Client app

### Navigation (Expo Router)

```
app/(onboarding)/welcome            O00
app/(onboarding)/choose-path        O01 (choice cards)
app/(onboarding)/privacy            O02
app/(auth)/sign-in                  O01 owner welcome: Apple + email
app/(auth)/email-code               code entry, resend, S05 expired state
app/(auth)/your-name                email sign-ups only
app/(onboarding)/all-set            O03 (confetti)
app/(tabs)/home                     O02 Hello / S01 empty registry
app/(tabs)/find                     placeholder (mint)
app/(tabs)/alerts                   placeholder
app/(tabs)/account                  name, email, sign out, delete account
app/pets/new                        O03 basics + Save as draft
app/pets/[id]/photos                O04 capture (front, side, markings)
app/pets/[id]/index                 O05 private profile
app/plans                           Compare plans (W06 card style)
```

Signed-out users who have finished onboarding start at sign-in. Signed-in users without a completed profile name go to `your-name`.

### Design system (`packages/ui`)

- **Tokens:** generated from the Figma variables (Palette, Color, Space, Motion collections) into `tokens.ts`. Covers colours including the flow tints and the six card roles, spacing, radii (cards 24, fields 12, buttons 16), and motion durations and easings.
- **Typography:** Inter 400/500/600/700. Scale 28/39 headline, 22/28 section, 17/22 card title, 15/20 note title, 14/20 body, 13/18 small, 12/16 caption.
- **Primitives:**
  - Button: primary / secondary / urgent / disabled, 48pt.
  - Field, Switch, Checkbox.
  - Chip: Private / Missing / Recovered.
  - PrivacyBanner.
  - `Card role="privacy | tip | community | warning | celebration | attention | plain"`.
  - PetPortrait: flow gradient, sticker and label.
  - ScreenShell: flow tint, two ambient glows, safe areas.
  - StepDots, TabBar, WebNav, MotionSafe.
- **Stickers:** the 14 stickers from board 09, as `react-native-svg` components generated from the same SVG source as the Figma file. The die-cut shadow is a low-opacity offset copy of the outline, with no runtime blur. Stickers are decorative: hidden from VoiceOver and screen readers, and never used to convey status.
- **Motion (Reanimated):**
  - `peel` (420ms, cubic-bezier 0.34, 1.56, 0.64, 1)
  - `float` (3.2s loop, 10px, ±2°, 400ms stagger)
  - `twinkle` (1.6s)
  - `pawTrail` (120ms per print)
  - `moonrise` step transition (360ms, 0.2, 0.8, 0.2, 1)
  - `confetti` (900ms, 0.16, 1, 0.3, 1)

  With Reduce Motion on, loops stop and entrances become a 160ms fade. Buttons accept taps from the first frame. Status text, privacy notices and error messages never animate.

### Data layer (`apps/app/src/data`)

- TanStack Query hooks per resource: `usePets`, `usePet`, `useCreatePet`, `usePhotoUpload`, `useEntitlement`, `useProfile`.
- Network failures retry up to 3 times with backoff. Typed `AppError` codes are never retried, except `RATE_LIMITED`.
- The query cache is persisted (AsyncStorage on iOS, IndexedDB on web) for offline reads.
- The add-pet draft is stored locally until submitted.
- The session is stored securely with `expo-secure-store` on iOS and Supabase's default storage on web.

### Accessibility and copy

- AA contrast (already checked for every colour pair).
- 44pt minimum tap targets.
- Dynamic Type up to XL, with screens scrolling rather than clipping.
- VoiceOver labels on all controls.
- English copy lives in one `copy` module per feature for later localisation.

## 9. Error handling and offline behaviour

| Situation | Behaviour |
|---|---|
| `PET_LIMIT_REACHED` | Explains the Free 3-pet limit and links to Compare plans. |
| `PHOTO_QUALITY` (device or server) | Guidance plus a retake. The previous good photo is kept. |
| Upload interrupted | The photo stays `pending`. Retry is offered. Cleanup removes abandoned rows after 24 hours. |
| `RATE_LIMITED` | "Take a short break and try again", with a retry after a delay. |
| Email code expired or wrong | S05 state with "Send a new code". Supabase's code rate limits apply. |
| Apple sign-in cancelled | Silent return to sign-in. |
| Offline | Offline banner. Cached pets read-only. Add-pet basics saved as a draft. Photo actions disabled with an explanation. |
| Invite-only rejection | "This pilot is invite-only", with a contact link. |
| Unexpected error | Friendly generic message. The error goes to Sentry with personal data scrubbed (no names, emails or file paths). |

## 10. Security, privacy and cost guards

- Every write goes through the server functions in section 6. Row-level security is enforced in the database, not just in the client.
- Photos are never public. Signed URLs expire after one hour.
- Audit events contain no personal data.
- Account deletion removes files and rows. The audit trail keeps only the action and the time.
- Cost guards:
  - JPEG at 1600px long edge, at most 4 MB.
  - 30 uploads per user per hour.
  - 6 photos per pet.
  - Supabase spend alerts.
- Expected monthly cost: Supabase Pro (~$25) plus EAS free/starter tier. The Apple Developer Program is $99 a year.

## 11. Testing strategy

Work is test-first, following the superpowers TDD skill.

| Layer | Tool | Must prove |
|---|---|---|
| `packages/core` | Vitest | Validation boundaries, tier limits, photo thresholds, error parsing |
| Database | pgTAP on local Supabase | Owner isolation for every table and storage path; each function's rules, errors, idempotency and audit event; the 3-pet limit holds under concurrent calls; no client write paths exist |
| `packages/api` | Vitest integration against local Supabase | Real sign-in with test users; the full pet and photo lifecycle; error mapping |
| App components | Jest + React Native Testing Library | Form validation, error and offline states, Reduce Motion fallback |
| End-to-end iOS | Maestro on the iOS Simulator | Onboarding → email code (from local Mailpit) → name → add pet → 3 photos (fixture images) → profile → delete pet |
| End-to-end web | Playwright | The same happy path at 390px and 1440px widths |
| Visual | Screenshot review against the Figma frames | Each in-scope screen matches its frame's layout, colour roles and stickers |

`pnpm verify` runs typecheck, lint and every automated layer. A GitHub Actions workflow running the same command is included for when the repository is pushed.

## 12. Environments and delivery

- **Local:** Supabase CLI (Docker), Expo dev client on the simulator, web in the browser.
- **Pilot:** one hosted Supabase project. Migrations are applied with `supabase db push`. Edge Functions and Cron are deployed with the CLI.
- **iOS:** EAS Build profiles `development`, `preview` and `production`. Production builds go to TestFlight with EAS Submit.
- **Web:** `expo export --platform web`, deployed to EAS Hosting.
- **Secrets:** stored in EAS environment variables and Supabase secrets, never in the repository.
- **Setup only you can do** (a guided wizard script will walk through it):
  - Enrol in the Apple Developer Program.
  - Create the App Store Connect app record and a Sign in with Apple service ID.
  - Create the Supabase pilot project and add the Apple provider keys.
  - Create an EAS account.
  - Create a Sentry project.
  - Add tester emails to the pilot allowlist.

## 13. Deferred to later sub-projects

- **Recovery:** missing reports, the disclosure review (O06–O10) and turning on `discovery_enabled`.
- **Finder:** scan, matching and the three outcomes (F01–F09, W01–W04).
- **Alerts:** nearby alerts, saved areas and push (W05).
- **Messaging:** verified messaging and reports.
- **Operations:** purchases and entitlements from the stores, data export, operator tools, retention policies beyond photo cleanup.
