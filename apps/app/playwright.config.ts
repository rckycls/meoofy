import { defineConfig, devices } from '@playwright/test'

/** Its own port, so a dev server on Expo's usual one is never mistaken for the e2e build. */
const PORT = Number(process.env.E2E_WEB_PORT ?? 8099)
const ORIGIN = `http://127.0.0.1:${PORT}`

/**
 * The web happy path (spec section 11) at a phone's width and a desktop's. It needs the local
 * Supabase stack running (`pnpm db:start`), because the app talks to it for real, and Chromium
 * (`pnpm exec playwright install chromium`).
 */
export default defineConfig({
  testDir: './e2e/web',
  outputDir: './e2e/.results',
  // A cold sign-in, three uploads and a deletion run against a real backend. The browser's check
  // of a photo has been seen to take up to about ten seconds in some runs (cause not known yet),
  // so a test is allowed well beyond the usual 20 seconds.
  timeout: 150_000,
  expect: { timeout: 10_000 },
  // One at a time: every test talks to the same local stack, and one browser at a time keeps the
  // timings steady on a laptop.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  use: {
    baseURL: ORIGIN,
    // Loops stop and entrances become a short fade (spec section 8), so screenshots of a screen
    // always show it at rest, as its board frame does.
    reducedMotion: 'reduce',
    // A missing element fails in seconds, not at the test's timeout.
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-390',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'desktop-1440',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
  ],
  webServer: {
    // Exports the app with the end-to-end seams on, then serves it (see the script).
    // (The warning is Node noting that the TypeScript file has module syntax in a package that
    // doesn't say "type": "module", which Metro and Jest's CommonJS config files rule out.)
    command: 'node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON e2e/support/web-server.ts',
    url: ORIGIN,
    // Building takes a minute or two. A server already on the port (started by hand to skip the
    // build while editing a spec) is reused, except in CI.
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
