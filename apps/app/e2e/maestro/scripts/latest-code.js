/* global EMAIL, http, json, output -- Maestro's script runtime provides these. */
// Maestro runScript: reads the 6-digit sign-in code from the local Supabase stack's Mailpit and
// leaves it in `output.code`. EMAIL is the flow's variable. The iOS simulator shares the Mac's
// network, so 127.0.0.1 is the local stack. This is the same lookup as e2e/support/mailpit.ts,
// which the web test uses.
//
// `pnpm test:e2e:ios` signs in with an address nothing has been sent to (it clears the inbox
// first), so the newest message for it is this run's code and never an older one.
var MAILPIT = 'http://127.0.0.1:54324'
var address = EMAIL.toLowerCase()

function newestCode() {
  var list = json(http.get(MAILPIT + '/api/v1/messages?limit=500').body)
  var mine = list.messages.filter(function (message) {
    return message.To.some(function (to) {
      return to.Address.toLowerCase() === address
    })
  })
  if (mine.length === 0) return null
  mine.sort(function (a, b) {
    return a.Created < b.Created ? 1 : -1
  })
  var message = json(http.get(MAILPIT + '/api/v1/message/' + mine[0].ID).body)
  var match = /\b(\d{6})\b/.exec(message.Text)
  return match ? match[1] : null
}

// Auth sends the email a moment after the app asks: poll for up to 10 s. A script has no sleep,
// so it waits by spinning.
var code = null
var deadline = Date.now() + 10000
while (code === null && Date.now() < deadline) {
  code = newestCode()
  if (code === null) {
    var pause = Date.now() + 250
    while (Date.now() < pause) {
      // Wait.
    }
  }
}
if (code === null) throw new Error('No 6-digit code for ' + EMAIL + ' in Mailpit')
output.code = code
