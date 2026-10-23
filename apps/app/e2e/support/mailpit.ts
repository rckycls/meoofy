// Reads sign-in codes from the local stack's Mailpit (Supabase's `[inbucket]`, port 54324). The
// app can't import the API package's test helpers, so this is the same idea written for the
// end-to-end tests.
//
// A code can't be mistaken for an older one, whatever the test does:
//   - `latestCode` needs an `InboxMark`, which `markInbox` takes before the action that sends the
//     email, and only looks at messages that were not in the inbox then. A message that arrived
//     earlier, such as the first email when a code is requested again, is never a candidate, and
//     no code can be read without saying when the sending began.
//   - a message is used once per process, so a mark taken too early (or reused) still can't return
//     the same code twice.
//   - the fixture also clears the inbox of the test's address before it starts, so nothing from an
//     earlier run is there to begin with.
const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324'

type Summary = { ID: string; Created: string; To: { Address: string }[] }

/** The messages an address's inbox held when `markInbox` was called. */
export type InboxMark = { readonly email: string; readonly ids: ReadonlySet<string> }

/** Messages whose code `latestCode` has already returned. */
const used = new Set<string>()

/** Every message to `email`, newest first. */
async function messagesTo(email: string): Promise<Summary[]> {
  const response = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=500`)
  if (!response.ok) throw new Error(`Mailpit answered ${response.status} for the message list`)
  const { messages } = (await response.json()) as { messages: Summary[] }
  const target = email.toLowerCase()
  return messages
    .filter((message) => message.To.some((to) => to.Address.toLowerCase() === target))
    .sort((a, b) => b.Created.localeCompare(a.Created))
}

/** Deletes every message to `email`, so only what is sent from now on is in its inbox. */
export async function clearInbox(email: string): Promise<void> {
  const ids = (await messagesTo(email)).map((message) => message.ID)
  if (ids.length === 0) return
  const response = await fetch(`${MAILPIT_URL}/api/v1/messages`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ IDs: ids }),
  })
  if (!response.ok) throw new Error(`Mailpit answered ${response.status} deleting messages`)
}

/**
 * Notes what is in `email`'s inbox now. Call it right before the action that makes the app send a
 * code (and, to read a second code, again before asking for it), then read the code with
 * `latestCode`.
 */
export async function markInbox(email: string): Promise<InboxMark> {
  return { email, ids: new Set((await messagesTo(email)).map((message) => message.ID)) }
}

/**
 * The 6-digit code in the newest message to `email` that is not in `mark` and was not used
 * before. Polls for up to `timeoutMs` (10 s), since Auth sends the email a moment after the app
 * asks.
 */
export async function latestCode(
  email: string,
  mark: InboxMark,
  timeoutMs = 10_000,
): Promise<string> {
  if (mark.email.toLowerCase() !== email.toLowerCase()) {
    throw new Error(`The inbox mark is for ${mark.email}, not ${email}`)
  }
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const fresh = (await messagesTo(email)).find(
      (message) => !mark.ids.has(message.ID) && !used.has(message.ID),
    )
    if (fresh !== undefined) {
      const response = await fetch(`${MAILPIT_URL}/api/v1/message/${fresh.ID}`)
      if (!response.ok) throw new Error(`Mailpit answered ${response.status} for a message`)
      const { Text } = (await response.json()) as { Text: string }
      const code = /\b(\d{6})\b/.exec(Text)?.[1]
      if (code !== undefined) {
        used.add(fresh.ID)
        return code
      }
    }
    if (Date.now() > deadline) throw new Error(`No new 6-digit code for ${email} in Mailpit`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}
