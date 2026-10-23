export default {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/*.test.{ts,tsx}'],
  // The package is small; skipping watchman keeps runs independent of a
  // machine's watchman state (a stale watch prints a recrawl warning).
  watchman: false,
}
