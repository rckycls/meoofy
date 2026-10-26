# Pet QR tag and the "Discovery is off" page: design

**Date:** 2026-10-26
**Builds on:** `2026-10-23-app-foundation-registry-design.md` (sub-project 1, merged at e233b45)
**Status:** approved in conversation, section by section, on 2026-10-26

## 1. Intent and success criteria

An owner can download a QR tag for any of their pets, with the Meoofy logo in the middle, and print it themselves. Anyone who scans the tag with a phone camera lands on a public Meoofy web page. While the pet's Discovery is off, which in this build is true of every pet, the page says the pet is registered and its details are private. It gives the finder practical next steps and reveals nothing about the pet or the owner.

The feature is done when:

- An owner opens a pet, taps **QR tag**, and can save a PNG and a printable PDF of the tag on iOS and on the web.
- The finished tag, logo included, decodes back to its exact link in an automated scan test.
- A signed-out phone that scans the tag sees the Discovery-off page, with no sign-in, no app install and no PawPin navigation.
- Signed-out visitors can call exactly one database function, and the tests prove it.
- `pnpm verify` passes, including the new database, unit, integration and web end-to-end tests.

## 2. Decisions

| Decision | Choice |
|---|---|
| How tags reach the world | Owners download and print them (PNG + printable PDF). No physical tag ordering. |
| What the QR holds | **The pet's id** (approach B, chosen by the owner over a separate resettable tag code). |
| Link format | `https://<tag domain>/t?p=<pet id>`. The id goes in the query string so that the static web export serves `t.html` for every scan (see the static output note in Ruling 50). |
| Tag domain | A domain the owner controls, set as `EXPO_PUBLIC_TAG_BASE_URL` (for example `https://meoofy.com`). It must never change once tags are printed. |
| Discovery-off page content | A notice plus finder tips. Nothing about the pet or owner. No "tell the owner" button. |
| Brand on tag and page | **Meoofy**, with the supplied logo. The rest of the app keeps "PawPin" until a separate rename. |
| Scan logging and alerts | None. Scans write nothing. |
| Rate limit | None for the pilot. Ids are random UUIDv4, the answer is one word, and the Supabase spend cap bounds cost. |

**What approach B costs:** a lost or stolen tag can't be retired or reset. It stays tied to its pet until the owner deletes the pet, after which it shows "unavailable". Knowing a pet id grants nothing, because every `api.*` call checks ownership through RLS or `NOT_OWNER`.

## 3. Architecture

### Server: one public, read-only function

This change goes in a new migration, `supabase/migrations/20261026000000_pet_tag_status.sql`. Following Ruling 15, no shipped migration is edited.

```
api.pet_tag_status(pet_id uuid) returns text
  language sql, stable, security definer, set search_path = ''
  -- 'discovery_off' when registry.pets has the id with registration_state = 'private'
  --                 and discovery_enabled = false
  -- 'unavailable'   in every other case: no row, archived, or (later) any state not listed
```

- It returns only the status word. It never returns names, species, photos, owner data or timestamps.
- Unknown, deleted and archived pets all return `unavailable`, so a caller can't tell them apart.
- `discovery_enabled = true` returns `unavailable` in this build. The Recovery sub-project adds `discoverable` together with its recovery projection. Until that projection exists, a discoverable pet must not be described publicly.

**Grants.** Today `anon` has no `usage` on schema `api`. This migration grants `usage on schema api to anon`, and `execute on function api.pet_tag_status(uuid) to anon, authenticated` after `revoke all … from public`. Nothing else changes. A pgTAP lockdown test proves the result: as `anon`, every function and view in `api` except `pet_tag_status` is neither executable nor selectable, checked with `has_function_privilege` and `has_table_privilege` over `pg_proc` and `pg_class` for namespace `api`.

**Audit.** None. A scan is not a state change, and logging it would store data about strangers.

### Shared code

- **`packages/core/src/tag.ts`**
  - `tagUrl(baseUrl: string, petId: string): string` trims trailing slashes and returns `${base}/t?p=${petId}`. It throws when `petId` isn't a UUID or `baseUrl` isn't `https://` (or `http://localhost` in development).
  - `parseTagParam(value: unknown): string | null` returns a lowercased UUID or `null`.
  - `TagStatus = 'discovery_off' | 'unavailable'`.
- **`packages/api/src/tags.ts`**
  - `getPetTagStatus(c: PawpinClient, petId: string): Promise<TagStatus>` calls `rpc('pet_tag_status')`. It works without a session and maps errors through the existing `normalizeSupabaseError` / `parseAppError`.
  - Any unexpected value maps to `unavailable`. That is the safe default.
- **`packages/ui`**
  - `MeoofyMark`: the logo traced to vector from the supplied PNG, which is committed as `docs/product/brand/meoofy-logo.png` (1536×1024, transparent background). The trace is stored at `packages/ui/assets/brand/meoofy-mark.svg` with a square viewBox cropped to the mark, and a generated `react-native-svg` component is built from it like the stickers.
  - Brand blue is **`#2A52CF`**, sampled from the logo. The trace task confirms the exact value and adds it as a token.
  - The mark is decorative wherever a text name sits beside it.

### App: the owner's QR tag screen

- **Entry point:** the pet profile (O05) gains a **QR tag** card that opens `/pets/[id]/tag`. Like the other `/pets/[id]` routes, a hard reload of this owner-only screen on hosted web carries the Ruling 50 caveat. The public `/t` page does not, because it is static.
- **`src/features/tag/QrTag.tsx`** renders the tag as one SVG:
  - The QR pattern comes from the pure-JS **`qrcode`** package: `QRCode.create(url, { errorCorrectionLevel: 'H' })`, then its module matrix.
  - Modules are drawn as squares in brand blue on white, with a 4-module quiet zone. The three finder patterns keep the standard shape.
  - `MeoofyMark` sits centred on a white rounded square. The backing is at most **22% of the code's width**, inside the roughly 30% that H-level error correction can recover.
  - Below the code: the caption **"If I'm lost, scan me"**, and the tag domain in small text.
  - No pet name appears on the tag.
- **`src/features/tag/exportTag.ts`:**
  - **PNG:** a 1200×1200 image. On iOS, render the SVG view with `react-native-view-shot` and share it with `expo-sharing`. On the web, rasterise the SVG to a canvas and trigger a download.
  - **PDF:** `expo-print` with an HTML page that inlines the tag SVG at **25 mm, 30 mm and 38 mm**. On iOS, use `printToFileAsync` and share the file. On the web, use `printAsync`, which opens the browser's print dialog.
  - New dependencies are installed with `npx expo install` and pinned exactly.
- **Gating:**
  - In production builds with no `EXPO_PUBLIC_TAG_BASE_URL`, the screen shows "Tags will be ready soon" and the downloads are disabled, with that explanation.
  - In development builds the base URL falls back to the local web origin, and the tag carries a red **"Test tag, not for printing"** band.
- **Offline:** generation needs only the pet id and the base URL, so the screen works offline.
- **Copy:** in `src/features/tag/copy.ts`.
- **Accessibility:** the preview is labelled "QR tag for {name}". Tap targets are at least 44 pt. Desktop uses the two-column W06 layout.

### App: the public page `/t`

`app/t.tsx` is a static route that exports to `t.html`. It renders outside the onboarding and entry gate and outside the tabs, so there is no tab bar, web nav or offline banner. It reads `p` from the query string after load.

| State | When | Copy |
|---|---|---|
| Loading | Lookup in flight | Spinner only; text never animates. |
| Discovery off | `discovery_off` | **This pet is registered with Meoofy.** Its owner hasn't turned on Discovery, so its details stay private. |
| Unavailable | `unavailable` | **This tag isn't linked to a registered pet anymore.** |
| Broken link | `p` missing or not a UUID (no server call) | **This link looks incomplete.** Try scanning the tag again. |
| Can't check | `NETWORK`, `UNKNOWN` or `RATE_LIMITED` | **We couldn't check this tag right now.** Plus a **Try again** button. |

Every state also shows the finder-tips card, **"If you've found this pet"**:
1. Check the collar for a phone number.
2. A vet or animal shelter can scan for a microchip, usually for free.
3. Keep the pet somewhere safe and calm.
4. If the owner reports their pet missing, scanning this tag again will show how to help.

- **Footer:** a small link, "Protect your own pet with Meoofy", pointing to `/`.
- **Branding:** the `MeoofyMark` plus the "Meoofy" wordmark, with the finder (mint) flow tint from the existing tokens. It works at 390 px and 1440 px.
- **Privacy:** the page sets `<meta name="robots" content="noindex, nofollow">` and the title "Meoofy". It has no analytics, and Sentry scrubbing is unchanged.

### Delivery

- **Setup wizard:** a new step asks for the tag domain, explains that it can't change once tags are printed, and walks through adding it as an EAS Hosting custom domain (DNS). It then stores `EXPO_PUBLIC_TAG_BASE_URL` with `eas env:set` and asks for consent before running the command.
- **`.env.example`:** documents the variable.
- **README:**
  - Add "print tags only after the domain serves the hosted `/t` page" to the owner follow-ups.
  - Add a smoke check: open `https://<domain>/t?p=<a real pet id>` on a phone.

## 4. Error handling

| Situation | Behaviour |
|---|---|
| Lookup fails (offline, 5xx) | "We couldn't check this tag right now", Try again, and the tips are still shown. |
| Malformed or missing `p` | Broken-link state, with no network call. |
| Pet deleted after printing | `unavailable`. |
| Base URL unset in production | Downloads disabled with an explanation. |
| PNG or PDF export fails or is cancelled | A cancelled share is silent. A failure shows "Couldn't save the tag. Try again." and is reported through the existing handled-error path. |

## 5. Testing

- **pgTAP (`supabase/tests/database/080_pet_tag_status.test.sql`):**
  - The status for a private, Discovery-off pet is `discovery_off`.
  - Deleted, archived and unknown ids are all `unavailable`.
  - `discovery_enabled = true` is `unavailable` in this build.
  - The function is SECURITY DEFINER with `search_path=''`.
  - The anon lockdown: nothing else in `api` is executable or selectable by `anon`.
- **Core:** `tagUrl` (trailing slash, a non-UUID throws, https enforcement) and `parseTagParam`.
- **API:**
  - Unit: `getPetTagStatus`, including mapping an unexpected value to `unavailable` and network errors.
  - Integration: with a **signed-out** client against the local stack.
- **App (jest):**
  - `QrTag`: the matrix comes from level H, the logo backing is at most 22% of the width, the quiet zone is 4 modules, and the test band appears only in development.
  - The tag screen: gating, actions calling the export functions, labels.
  - `/t`: all five states, with the tips present in each.
- **Scan proof:** render the finished `QrTag` SVG to PNG with `@resvg/resvg-js` (dev-only) and decode it with `jsqr` (dev-only). It must equal the exact `tagUrl`. Run this at the PNG export size and at a 25 mm-at-300-dpi size (about 295 px).
- **E2E (Playwright, both projects):**
  - A signed-in owner opens the tag screen and sees the preview and actions.
  - A fresh signed-out context visiting `/t?p=<that pet's id>` sees the Discovery-off copy.
  - A random UUID shows unavailable.
  - Bare `/t` shows broken link.

## 6. Out of scope

- Discovery on and the recovery profile on the tag page. These belong to the Recovery sub-project, which adds `discoverable`.
- Retiring or resetting tags. This is not possible with approach B; switching to a separate tag code later would need a new design.
- Scan alerts, scan history and scan logging.
- Renaming the app from PawPin to Meoofy.
- Ordering physical tags, NFC tags, and universal or app links from a scan.
- New Figma frames for these screens. They use existing components; frames can be added later.
