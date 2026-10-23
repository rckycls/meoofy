// Values for src/env.ts. Tests never reach a server: anything that would talk
// to Supabase gets a fake client instead.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
)

// TanStack Query schedules garbage-collection timers (a week, for the
// persisted cache) that would keep Jest alive after the last test. Unref'd
// timers still fire but no longer hold the process open.
const { timeoutManager } = require('@tanstack/react-query')
timeoutManager.setTimeoutProvider({
  setTimeout: (callback, delay) => {
    const id = setTimeout(callback, delay)
    id?.unref?.()
    return id
  },
  clearTimeout: (id) => clearTimeout(id),
  setInterval: (callback, delay) => {
    const id = setInterval(callback, delay)
    id?.unref?.()
    return id
  },
  clearInterval: (id) => clearInterval(id),
})
