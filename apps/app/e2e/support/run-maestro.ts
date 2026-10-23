// `pnpm test:e2e:ios`: runs the Maestro flow in e2e/maestro on the booted iOS Simulator. It signs
// in with an address of its own: allowlisted before the run, with an empty inbox (so the code is
// this run's, never an older one's), and removed again afterwards. The flow gets it as EMAIL.
//
// It needs the local Supabase stack (`pnpm db:start`), Maestro, and a development build installed
// on the simulator that was made with EXPO_PUBLIC_E2E=1, which is what shows "Use test photo". That
// variable is for this build only and is never set for a production one.
//
// Node runs this file directly (type stripping), so it uses only erasable syntax.
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { allowlistOwner, removeOwner } from './database.ts'
import { clearInbox } from './mailpit.ts'

const flows = fileURLToPath(new URL('../maestro/', import.meta.url))
const email = `e2e+${Date.now()}-${randomUUID().slice(0, 8)}@pawpin.test`

let status = 1
try {
  await allowlistOwner(email)
  await clearInbox(email)
  const run = spawnSync('maestro', ['test', '--env', `EMAIL=${email}`, flows], {
    stdio: 'inherit',
  })
  if ((run.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    console.error(
      'Maestro is not installed. Install it (https://docs.maestro.dev/getting-started/installing-maestro), ' +
        'boot an iOS Simulator with a development build made with EXPO_PUBLIC_E2E=1, and run this again.',
    )
  } else {
    status = run.status ?? 1
  }
} finally {
  await removeOwner(email)
}
process.exit(status)
