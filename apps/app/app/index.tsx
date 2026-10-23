import { Redirect } from 'expo-router'

import { useEntryRoute } from '../src/navigation/useEntryRoute'

/** Cold-start entry: sends the user to onboarding, sign-in, the name step or a tab. */
export default function Index() {
  const route = useEntryRoute()
  // Still reading local state or the profile; the screen stays on the background colour.
  if (route === null) return null
  return <Redirect href={route} />
}
