// Reads sign-in codes from the local stack's Mailpit (Supabase's `[inbucket]`, port 54324). The
// app can't import the API package's test helpers, so this is the same idea written for the
// end-to-end tests.
//
// `codeAfter(email, send)` ties the read to the send. It notes which messages the inbox holds,
// runs `send` (the action that makes the app email a code), and returns the code in a message that
// was not there when it started. That guarantees:
//   - a message that was already in the inbox, read or not, is never returned, so the first
//     email's code cannot be taken for the code of a resend that has not arrived yet;
//   - there is no mark to keep and reuse: the inbox is noted inside the call, right before `send`.
// What it cannot know: which email is the answer to `send`. If an email from an earlier send lands
// only after this call has started, it looks the same as the new one. The tests read each code
// before they ask for the next, which is what rules that out; and the fixture clears the inbox of
// the test's address before it starts, so nothing from an earlier run is there either.
const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324'

type Summary = { ID: string; Created: string; To: { Address: string }[] }

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
 * Runs `send`, which makes the app email a code to `email`, and returns the 6-digit code in the
 * newest message that was not in the inbox when this call began. Polls for up to `timeoutMs`
 * (10 s) after `send` finishes, since Auth sends the email a moment after the app asks.
 */
export async function codeAfter(
  email: string,
  send: () => Promise<unknown>,
  timeoutMs = 10_000,
): Promise<string> {
  const before = new Set((await messagesTo(email)).map((message) => message.ID))
  await send()
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const fresh = (await messagesTo(email)).find((message) => !before.has(message.ID))
    if (fresh !== undefined) {
      const response = await fetch(`${MAILPIT_URL}/api/v1/message/${fresh.ID}`)
      if (!response.ok) throw new Error(`Mailpit answered ${response.status} for a message`)
      const { Text } = (await response.json()) as { Text: string }
      const code = /\b(\d{6})\b/.exec(Text)?.[1]
      if (code !== undefined) return code
    }
    if (Date.now() > deadline) throw new Error(`No new 6-digit code for ${email} in Mailpit`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}
