import type { QueryClient } from '@tanstack/react-query'
import { getProfile, updateDisplayName, type MeoofyClient } from '@meoofy/api'
import { displayNameSchema } from '@meoofy/core'

/**
 * Saves the display name, then puts the saved profile in the query cache so the next screen (the
 * entry gate, or the greeting on the last onboarding screen) shows the new name instead of the
 * empty one it was cached with. If the profile can't be read back the screens read it themselves.
 */
export async function saveDisplayName(
  client: MeoofyClient,
  queryClient: QueryClient,
  name: string,
): Promise<void> {
  await updateDisplayName(client, name)
  await queryClient
    .fetchQuery({
      queryKey: ['profile'],
      queryFn: () => getProfile(client),
      staleTime: 0,
      // The person is waiting on this; the screens retry it themselves.
      retry: false,
    })
    .catch(() => undefined)
}

/**
 * First sign-in with Apple: Apple hands over the person's name once, so it is kept now or never.
 * Names a profile that has no name yet with Apple's given name, and says whether it did. Never
 * rejects: if the name can't be saved, the entry gate asks for it on the name step instead.
 */
export async function nameFromApple(
  client: MeoofyClient,
  queryClient: QueryClient,
  givenName: string | null | undefined,
): Promise<boolean> {
  const parsed = displayNameSchema.safeParse(givenName ?? '')
  if (!parsed.success) return false
  try {
    const profile = await getProfile(client)
    if (profile.displayName.trim() !== '') return false
    await saveDisplayName(client, queryClient, parsed.data)
    return true
  } catch {
    return false
  }
}
