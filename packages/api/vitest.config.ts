import { defineConfig } from 'vitest/config'

// Two projects so the default `test` needs no running services:
// - unit: plain Vitest, no network (`pnpm --filter @pawpin/api test`, part of `pnpm verify`).
// - int: against the local Supabase stack (`pnpm test:api`); needs `supabase start`.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'int',
          environment: 'node',
          include: ['test/**/*.int.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
})
