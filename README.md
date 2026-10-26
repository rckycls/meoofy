# Meoofy

A private registry for pets. Owners sign in with Apple or a 6-digit email code, register their dogs and
cats with reference photos, and keep every detail private until it is needed.

This repository is sub-project 1, the app foundation and private registry: an Expo universal app
(iOS and web) on a thin Supabase backend. The pilot is invite-only.

- Product spec: [`docs/product/meoofy-design-spec.md`](docs/product/meoofy-design-spec.md)
- This sub-project's design: [`docs/superpowers/specs/2026-10-23-app-foundation-registry-design.md`](docs/superpowers/specs/2026-10-23-app-foundation-registry-design.md)

| Folder | What is in it |
|---|---|
| `apps/app` | The Expo app (Expo Router, iOS and web), its Jest tests and end-to-end tests |
| `packages/core` | Domain rules shared by the app and the database: limits, validation, error codes |
| `packages/api` | The typed client for the Supabase backend |
| `packages/ui` | The design system: tokens, components, stickers, motion |
| `supabase` | Migrations, pgTAP tests, the Edge Functions, the sign-in email template, `config.toml` |
| `tools` | Generators (tokens, fixtures, stickers) and the pilot setup wizard |

## Contents

- [Local development](#local-development)
- [Verify](#verify)
- [End-to-end tests](#end-to-end-tests)
- [Deploying the pilot](#deploying-the-pilot)
- [iOS native notes](#ios-native-notes)
- [Database rules](#database-rules)
- [Owner follow-ups](#owner-follow-ups)

## Local development

You need:

- Node 24 and pnpm 11 (`corepack enable` picks the pnpm version from `package.json`)
- Docker (Docker Desktop or OrbStack) for the local Supabase stack
- Xcode and an iOS Simulator, for the iOS app
- [Deno](https://deno.com), for the Edge Function tests and type-check

```sh
pnpm install
pnpm db:start                          # the local Supabase stack; prints the API URL and anon key
cp apps/app/.env.example apps/app/.env # then paste the anon key from `pnpm db:start`

pnpm --filter @meoofy/app web          # the web app in a browser
pnpm --filter @meoofy/app ios          # the iOS app in the simulator (see "iOS native notes")
```

The app depends on `expo-dev-client`, so `expo start` (and the `ios` script above) opens a development
build of Meoofy, not Expo Go. Make that build once with `expo run:ios` (see
[iOS native notes](#ios-native-notes)), or start with `--go` to use Expo Go instead:
`pnpm --filter @meoofy/app exec expo start --go`. The web is not affected: the `web` script runs
`expo start --web`, which opens the app in a browser.

Sign-in codes are emailed to a local inbox, [Mailpit](http://127.0.0.1:54324). The pilot is
invite-only even locally: `supabase/seed.sql` allowlists `owner@meoofy.test` and `e2e@meoofy.test`.
To use another address, insert it into `identity.pilot_allowlist`.

Useful scripts (all from the repository root):

| Script | What it does |
|---|---|
| `pnpm db:start` / `pnpm db:reset` | Start the local stack / rebuild its database from the migrations and seed |
| `pnpm gen:types` | Regenerate `packages/api/src/database.types.ts` from the local database |
| `pnpm gen:tokens`, `gen:stickers`, `gen:fixtures` | Regenerate the design tokens, sticker components and test photos |

The app's settings are `EXPO_PUBLIC_*` variables, listed in [`apps/app/.env.example`](apps/app/.env.example).
They are public: Expo copies them into the app. A service-role key never belongs in them.

## Verify

```sh
pnpm verify
```

runs every automated layer (spec section 11), stopping at the first that fails:

| Command | Layer |
|---|---|
| `pnpm typecheck` | TypeScript in every package |
| `pnpm typecheck:functions` | `deno check` of the two Edge Function entry points |
| `pnpm lint` | ESLint |
| `pnpm test` | Unit tests: Vitest (`core`, `api`) and Jest (`ui`, `app`) |
| `pnpm test:functions` | Deno tests for the Edge Function logic |
| `pnpm test:db` | pgTAP: row-level security, every function, limits under concurrency |
| `pnpm test:api` | Integration tests of `packages/api` against the local stack |
| `pnpm test:e2e:web` | The web end-to-end tests (below) |

Each command also runs on its own. `verify` works on the database as it is: it never resets it, and the
database tests only look at their own rows, so it passes again on a database it (or you) has already
used. It needs:

- the local Supabase stack running (`pnpm db:start`);
- Deno;
- Chromium for Playwright: `pnpm --filter @meoofy/app exec playwright install chromium`;
- `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`, from `apps/app/.env` or exported in
  the shell (CI exports them from `supabase status -o env`, because `.env` is git-ignored).

The Deno scripts set `DENO_NO_PACKAGE_JSON=1`: Deno 2.9 would otherwise rewrite `package.json` while
resolving `npm:` imports. Set it yourself for any other Deno command here.

CI ([`.github/workflows/verify.yml`](.github/workflows/verify.yml)) starts the stack and runs the same
`pnpm verify`, on every push to `main` and every pull request. It cannot run the iOS end-to-end flow
(below), which needs a Mac.

## End-to-end tests

**Web** (`pnpm test:e2e:web`, part of `verify`). Playwright drives the production web export at 390 and
1440 px against the local stack. It builds that export itself, with the test-only seams on
(`EXPO_PUBLIC_E2E=1`, which shows "Use test photo"), in `apps/app/node_modules/.cache/e2e-web`, never in
`dist/`. Screenshots for the visual review are saved to `apps/app/e2e/screenshots` (git-ignored).

**iOS** (`pnpm test:e2e:ios`, not part of `verify`). A [Maestro](https://docs.maestro.dev) flow on the
iOS Simulator, which is run by hand on a Mac before each TestFlight build. It needs:

1. The local Supabase stack.
2. Maestro installed. This is an owner decision: it is installed from a third-party Homebrew tap
   (see the [install guide](https://docs.maestro.dev/getting-started/installing-maestro)).
3. A booted simulator with a development build installed that was made with the test seams on. Pass
   `EXPO_PUBLIC_E2E=1` on the command line for that one build, and never put it in a file:

   ```sh
   EXPO_PUBLIC_E2E=1 LANG=en_US.UTF-8 pnpm --filter @meoofy/app exec expo run:ios
   ```

The flow assumes a debug build with Metro serving it, and it has not been run yet (Maestro is not
installed on the build machine). The project now includes `expo-dev-client`, so a debug build opens
Expo's development launcher on a fresh start rather than the app. Expect to adjust the flow's
`launchApp` step the first time it runs (for example to open the dev-client link, or to use a Release
build, which has no launcher).

## Deploying the pilot

Everything that needs your accounts (Apple, Supabase, Sentry, EAS) is walked through by a wizard:

```sh
./tools/setup/pilot-setup.sh
```

It opens each page, says what to click and what to copy, and remembers your answers in `.env.pilot`
(git-ignored). **It shows every command and asks before running it**, and it never asks for a password,
the Supabase service-role key or a token. You can stop and run it again any time.

What it covers, in order: Apple Developer enrolment, the bundle id and App ID, the App Store Connect
record, the Supabase project, the spend cap and usage alerts (budget target US$200 a month),
`pnpm db:push` and the `verify_jwt` check, Sign in with Apple, the auth hook, the Vault secrets, the
Data API schemas and `pg_graphql`, the sign-in email (SMTP, 6-digit code, template), the support address,
Sentry, EAS, the first web deploy, the redirect allowlist, the tester allowlist, and the first TestFlight
build.

### Commands

| Command | What it runs |
|---|---|
| `pnpm db:push` | `supabase db push && supabase functions deploy delete-account storage-cleanup` |
| `pnpm deploy:web` | `expo export --platform web && eas deploy --prod` |
| `pnpm build:ios` | `eas build -p ios --profile production` |
| `pnpm submit:ios` | `eas submit -p ios --latest` (to TestFlight) |

They need the Supabase CLI logged in and linked (`pnpm exec supabase login`, `supabase link`) and the EAS
CLI (`npm install -g eas-cli`, then `eas login`).

`pnpm deploy:web` exports with whatever `EXPO_PUBLIC_*` values it can see, and `apps/app/.env` holds your
**local** ones. Run it with the hosted values from EAS instead:

```sh
cd apps/app && eas env:exec production "pnpm deploy:web"
```

That script exports and uploads in one go, with no look at the export in between. The wizard does it in
three separate steps so nothing is published unchecked: export with the EAS production variables, check
that `apps/app/dist` neither points at `127.0.0.1:54321` nor has `EXPO_PUBLIC_E2E` on, and only then
`eas deploy --prod`.

### EAS build profiles (`apps/app/eas.json`)

| Profile | For | Notes |
|---|---|---|
| `development` | A development client | `developmentClient: true`, `EXPO_PUBLIC_E2E=1`. Needs `expo-dev-client`, which the app depends on (pinned). Its config plugin adds a local-network purpose string (`NSLocalNetworkUsageDescription`), an `_expo._tcp` entry in `NSBonjourServices` and an `exp+meoofy` URL scheme to the Info.plist; a build phase strips the first two from Release builds, so only the scheme ships in production, where it does nothing but open the app. The launcher itself is left out of Release builds |
| `preview` | Internal testing builds | `distribution: internal` |
| `production` | TestFlight and the App Store | `autoIncrement: true`, and never `EXPO_PUBLIC_E2E` |

Builds read their `EXPO_PUBLIC_*` values from the EAS environment of the same name. Nothing secret is in
`eas.json`, and `apps/app/src/config.test.ts` checks that production never sets `EXPO_PUBLIC_E2E`.

### Variables

| Variable | Where it is set | Public? |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | EAS (production, preview); `apps/app/.env` locally | Yes |
| `EXPO_PUBLIC_SENTRY_DSN` | EAS; optional | Yes |
| `EXPO_PUBLIC_SUPPORT_EMAIL` | EAS; optional | Yes. A shared support address, not a personal one. When set, the invite-only message links to it; when unset, or when it is not a plain address (spaces, `?`, `&`, `,` and `;` are refused), there is no link |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | EAS; optional, build time | The token is a **secret**. All three are needed together to upload source maps. With no token a build skips the upload |
| `EXPO_PUBLIC_E2E` | Command line, for one build | Never in a file, never in production |

### Hosted web notes

- **Reloading a pet's page may 404 on EAS Hosting.** The web build is a static export
  (`web.output: 'static'`, which the spec asks for): one HTML page per route, made at build time. The
  routes `/pets/<id>`, `/pets/<id>/edit` and `/pets/<id>/photos` have no page of their own, because pet
  ids are user data and cannot be listed at build time (so `generateStaticParams` is not possible), and
  for static output Expo writes `_expo/.routes.json` without rewrites. In-app navigation is not affected.
  A hard reload, a bookmark or a link someone sends to one of those addresses may answer 404.
  - We have only seen a stand-in static server: it answers unknown paths with the export's not-found page,
    which boots the app and shows the right screen, with one recoverable React hydration notice (error
    418). **EAS Hosting itself has not been checked.**
  - **Check it on the first deploy:** open a pet's profile, then its photos and edit pages, and hard
    reload each. The wizard lists this as a pilot check.
  - **If they 404, switch to server output:** set `web.output: 'server'` in `apps/app/app.config.ts`.
    EAS Hosting supports it, and no route code has to change: the routes are rendered on demand, so
    `/pets/<id>` works. For `deploy:web`: the command stays `expo export --platform web && eas deploy
    --prod`, but the export now has `dist/client` and `dist/server`, and a server runtime that reads its own
    variables from EAS, so deploy with `eas deploy --prod --environment production`. `EXPO_PUBLIC_*` values
    are still put into the client at export time, so keep running the export through `eas env:exec
    production`. Two things assume static output and must change with it: `config.test.ts` (it asserts
    `web.output === 'static'`) and the end-to-end web server (`e2e/support/web-server.ts`, a static file
    server over the export, which would serve it with `expo serve` instead).
- Every other route, at 390 and 1440 px, loads with no hydration warning.
- Web Apple sign-in uses PKCE: a person must finish signing in in the same browser, on the same origin,
  where they started it.

## iOS native notes

- The native projects are generated, not committed: `apps/app/ios/` and `apps/app/android/` are git-ignored
  (Continuous Native Generation). After changing `app.config.ts`, a plugin or a native dependency, start
  clean:

  ```sh
  pnpm --filter @meoofy/app exec expo prebuild --clean
  ```

- `pod install` (which `expo run:ios` and `prebuild` run) fails without a UTF-8 locale. Prefix the
  command: `LANG=en_US.UTF-8 pnpm --filter @meoofy/app exec expo run:ios`.
- `expo run:ios` rewrites the `ios` script in `apps/app/package.json`. Put it back to
  `expo start --ios` (see `git diff apps/app/package.json`) before you commit.
- The camera and photo-library permission texts, Sign in with Apple and the bundle id (`com.meoofy.pilot`)
  come from `apps/app/app.config.ts`, and `src/config.test.ts` checks what ends up in the Info.plist.

## Database rules

- **Never edit a migration that has shipped**, `supabase/migrations/20261023000000_limits.sql` included.
  Migrations that have been applied do not run again on a hosted database, so an edit would change only
  your local copy.
- **Changing the limits** (`LIMITS` in `packages/core`, or the tier pet limits) makes the parity test in
  `packages/core/src/sqlLimits.test.ts` fail. Run `pnpm gen:sql-limits`: it writes a **new** migration,
  `<UTC timestamp>_limits.sql`, that re-creates `registry.limits()` with `create or replace function`
  and brings the `pet-photos` bucket's size cap up to date. It never overwrites a migration, and it
  writes nothing when the newest migration that defines `registry.limits()` already matches; the parity
  test always checks that newest one. Commit the new file and apply it with `supabase migration up`
  locally (or `pnpm db:push`).
- A change to the auth hook in `supabase/config.toml` needs `supabase stop && supabase start` locally. On
  the hosted project the hook is switched on in the dashboard (Authentication, Hooks).
- Do not use `supabase config push`: it would copy the local `config.toml`, with its raised sign-in rate
  limits and local-only settings, onto the hosted project. Hosted rate limits stay at Supabase's defaults.
- The storage cleanup job reads two Vault secrets, `project_url` and `service_role_key`, which are created
  once per database, outside the migrations. `service_role_key` must equal the key the Edge Functions see
  as `SUPABASE_SERVICE_ROLE_KEY`. The wizard walks through it.
- On the hosted project only the `api` schema is exposed, and `pg_graphql` is switched off.

## Owner follow-ups

Things only the owner can do, or must decide:

1. **Install Maestro**, which needs you to trust its Homebrew tap, and run `pnpm test:e2e:ios` before each
   TestFlight build. The iOS flow has never been run.
2. **Verify Sign in with Apple on a real device.** The native Apple sign-in path has never run end to
   end: no automated test calls Apple, and it only works once the provider is configured on the hosted
   project.
3. **Give the web Apple button Apple-branded styling** before a public launch (Apple's Human Interface
   Guidelines).
4. **Regenerate the Apple sign-in secret** within six months of creating it and paste it into Supabase,
   or web sign-in stops working.
5. **Check hosted sign-in email limits.** Hosted Auth allows one code email per address per 60 seconds
   by default, and the app offers "Resend code" after the same 60 seconds. The defaults are kept on
   purpose; if you change the hosted limit, change `RESEND_AFTER` in
   `apps/app/src/features/auth/EmailCodeScreen.tsx` with it.
6. **Watch the Supabase spend** against the US$200 a month budget target.
7. **Reload a pet's profile, photos and edit pages on the hosted web app** after the first deploy. If
   they 404, switch `web.output` to `'server'` (see "Hosted web notes").
