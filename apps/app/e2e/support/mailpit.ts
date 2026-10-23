// Reads sign-in codes from the local stack's Mailpit (Supabase's `[inbucket]`, port 54324). The
// app can't import the API package's test helpers, so this is the same idea written for the
// end-to-end tests.
//
// A code can't be mistaken for an older one:
//   - a test signs in with an address nothing has been sent to (`clearInbox` makes sure), so the
//     first message to arrive is the test's own;
//   - a message is only ever used once per process, so asking again after "Resend code" waits for
//     the new message instead of returning the first one's code again.
const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324'

type Summary = { ID: string; Created: string; To: { Address: string }[] }

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
 * The 6-digit code in the newest message to `email` that was not used before. Polls for up to
 * `timeoutMs` (10 s), since Auth sends the email a moment after the app asks.
 */
export async function latestCode(email: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const newest = (await messagesTo(email)).find((message) => !used.has(message.ID))
    if (newest !== undefined) {
      const response = await fetch(`${MAILPIT_URL}/api/v1/message/${newest.ID}`)
      if (!response.ok) throw new Error(`Mailpit answered ${response.status} for a message`)
      const { Text } = (await response.json()) as { Text: string }
      const code = /\b(\d{6})\b/.exec(Text)?.[1]
      if (code !== undefined) {
        used.add(newest.ID)
        return code
      }
    }
    if (Date.now() > deadline) throw new Error(`No 6-digit code for ${email} in Mailpit`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}
