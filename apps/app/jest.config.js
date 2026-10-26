/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/*.test.{ts,tsx}'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  // Skipping watchman keeps runs independent of a machine's watchman state.
  watchman: false,
  // Reanimated 4 and Worklets ship native-only entry points; this resolver
  // picks their JS fallbacks so `@meoofy/ui`'s motion runs under Jest.
  resolver: 'react-native-reanimated/jest/resolver',
}
