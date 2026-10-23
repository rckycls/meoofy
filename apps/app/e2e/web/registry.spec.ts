// The registry happy path on the web, at a phone's width and a desktop's (playwright.config.ts has
// both projects): onboarding, sign-in with an emailed code, the name step, adding a pet, its three
// reference photos, the private profile and deleting the pet. It runs against the local Supabase
// stack, and the 6-digit code is read from local Mailpit like the Maestro flow reads it.
//
// The other tests cover the screens the happy path does not pass through (Compare plans, the tabs,
// the refused code, offline). Every in-scope screen is saved as a screenshot in e2e/screenshots
// (git-ignored), for the visual review against the board frames (spec section 11).
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { expect, test as base, type Page } from '@playwright/test'

import { allowlistOwner, removeOwner } from '../support/database'
import { clearInbox, latestCode, markInbox, type InboxMark } from '../support/mailpit'

const SCREENSHOTS = join(__dirname, '..', 'screenshots')

/** How long a photo may take to be checked and saved (see the happy path). */
const PHOTO_READY_TIMEOUT = 45_000

/** An owner who is on the pilot allowlist and has never signed in: a fresh address per test. */
const test = base.extend<{ email: string }>({
  // eslint-disable-next-line no-empty-pattern
  email: async ({}, use) => {
    const email = `e2e+${Date.now()}-${randomUUID().slice(0, 8)}@pawpin.test`
    await allowlistOwner(email)
    // An address nothing has been sent to yet, so the first code that arrives is this test's.
    await clearInbox(email)
    try {
      await use(email)
    } finally {
      // Tries every clean-up step, then throws one error listing any that failed. Playwright
      // reports that next to the test's own result and never in place of it.
      await removeOwner(email)
    }
  },
})

/**
 * Waits until the page has stopped changing: fonts loaded, every image loaded, and no element's
 * inline style (where the script-driven entrances and fades write their values) different from the
 * frame before, for six frames running. (The config sets Reduce Motion, so the entrances are short
 * fades and no loop keeps the page moving.) Gives up after three seconds rather than failing.
 */
async function settled(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const giveUp = setTimeout(resolve, 3_000)
        const look = () =>
          Array.from(
            document.querySelectorAll<HTMLElement>('[style]'),
            (e) => e.style.cssText,
          ).join('|') +
          Array.from(document.images, (image) => (image.complete ? 'y' : 'n')).join('')
        let before = look()
        let quiet = 0
        const frame = () => {
          const now = look()
          quiet = now === before ? quiet + 1 : 0
          before = now
          if (quiet < 6) return requestAnimationFrame(frame)
          clearTimeout(giveUp)
          resolve()
        }
        void document.fonts.ready.then(() => requestAnimationFrame(frame))
      }),
  )
}

/** Saves the screen as e2e/screenshots/<project>/<name>.png once it has settled. */
async function shot(page: Page, name: string) {
  await settled(page)
  const path = join(SCREENSHOTS, test.info().project.name, `${name}.png`)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, await page.screenshot())
}

/**
 * O00 to O02, then the email sign-in as far as the code screen. Returns the inbox as it was just
 * before the email was asked for, which is what the code is read against.
 */
async function toCodeScreen(page: Page, email: string): Promise<InboxMark> {
  await page.goto('/')
  await expect(page.getByText('Every pet deserves a way home.')).toBeVisible()
  await shot(page, '01-o00-welcome')
  await page.getByRole('button', { name: 'Get started', exact: true }).click()

  await expect(page.getByText('How would you like to help?')).toBeVisible()
  await shot(page, '02-o01-choose-path')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  await expect(page.getByText('Helpful in public. Private by default.')).toBeVisible()
  await shot(page, '03-o02-privacy')
  await page.getByRole('button', { name: 'Sounds good', exact: true }).click()

  await expect(page.getByText('Welcome to PawPin')).toBeVisible()
  await shot(page, '04-sign-in')
  await page.getByTestId('email-input').fill(email)
  const mark = await markInbox(email)
  await page.getByRole('button', { name: 'Sign in with email', exact: true }).click()

  await expect(page.getByText('Check your email')).toBeVisible()
  await shot(page, '05-email-code')
  return mark
}

/** The code from the email (sent after `mark`), the name step, and O03. */
async function toAllSet(page: Page, email: string, mark: InboxMark) {
  await page.getByTestId('code-input').fill(await latestCode(email, mark))

  // A first sign-in has no name yet, so the entry gate asks for one.
  await expect(page.getByText('What should we call you?')).toBeVisible()
  await shot(page, '06-your-name')
  await page.getByTestId('name-input').fill('Alex')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  await expect(page.getByText('You’re all set, Alex.')).toBeVisible()
  await shot(page, '07-o03-all-set')
}

/** O03, then "Explore PawPin": Home with nothing registered yet (S01). */
async function toEmptyHome(page: Page) {
  await page.getByRole('button', { name: 'Explore PawPin', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your circle starts here' })).toBeVisible()
}

test('registers a pet privately from onboarding to deletion', async ({ page, email }) => {
  await test.step('onboarding and sign-in with an emailed code', async () => {
    const mark = await toCodeScreen(page, email)
    await toAllSet(page, email, mark)
  })

  await test.step('Home starts empty (S01)', async () => {
    await toEmptyHome(page)
    await shot(page, '08-s01-home-empty')
  })

  await test.step('add Milo, a 3-year-old Golden retriever dog', async () => {
    await page.getByRole('button', { name: 'Add my first pet', exact: true }).click()
    await expect(page.getByText('Let’s meet your pet')).toBeVisible()
    await shot(page, '09-o03-add-pet')

    await page.getByTestId('pet-name-input').fill('Milo')
    await page.getByRole('radio', { name: 'Dog', exact: true }).click()
    await page.getByTestId('pet-breed-input').fill('Golden retriever')
    await page.getByTestId('pet-years-input').fill('3')
    await page.getByRole('button', { name: 'Continue to photos', exact: true }).click()
  })

  await test.step('three reference photos from the test photos', async () => {
    await expect(page.getByText('A clearer photo helps')).toBeVisible()
    await shot(page, '10-o04-photos')

    const views = ['Front', 'Side', 'Markings']
    for (const [index, view] of views.entries()) {
      // Only the selected tile offers the button; a saved photo moves the selection on.
      await page.getByRole('button', { name: 'Use test photo', exact: true }).click()
      // The browser checks the photo (decode, resize, sharpness and brightness) before it is sent,
      // which now and then takes about ten seconds here, so this waits longer than the default.
      await expect(page.getByRole('radio', { name: `${view} photo, ready` })).toBeVisible({
        timeout: PHOTO_READY_TIMEOUT,
      })
      const next = views[index + 1]
      if (next !== undefined) {
        await expect(page.getByRole('radio', { name: new RegExp(`^${next} photo`) })).toBeChecked()
      }
    }
    await expect(page.getByRole('radio', { name: /photo, ready$/ })).toHaveCount(3)
    await shot(page, '11-o04-photos-ready')
    await page.getByRole('button', { name: 'Done', exact: true }).click()
  })

  await test.step('Home lists Milo (O02)', async () => {
    // The photos step replaced the add form, so Done goes back to Home.
    await expect(page.getByRole('heading', { name: 'Hello, Alex' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Milo/ })).toBeVisible()
    await shot(page, '12-o02-home')
  })

  await test.step('the private profile says Discovery Off', async () => {
    await page.getByRole('button', { name: /^Milo/ }).click()
    await expect(page.getByText('Discovery Off', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Milo', exact: true })).toBeVisible()
    await expect(page.getByText('Milo is not searchable.')).toBeVisible()
    await shot(page, '13-o05-profile')
  })

  await test.step('delete Milo; Home is empty again', async () => {
    await page.getByRole('button', { name: 'Delete pet', exact: true }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Delete Milo?' })
    await expect(dialog).toBeVisible()
    // The safe choice comes first and has the focus, so a key press can't delete anything.
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    await shot(page, '14-o05-delete-dialog')
    // Watch the page for the not-found state, which must not flash up while the pet is deleted.
    await page.evaluate(() => {
      const seen = { notFound: false }
      Object.assign(window, { seen })
      new MutationObserver(() => {
        if (document.body.innerText.includes('We couldn’t find this pet')) seen.notFound = true
      }).observe(document.body, { subtree: true, childList: true, characterData: true })
    })
    await dialog.getByRole('button', { name: 'Yes, delete Milo', exact: true }).click()

    // A role query: the Home that was open before Milo's profile stays in the page, hidden.
    await expect(page.getByRole('heading', { name: 'Your circle starts here' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Milo/ })).toHaveCount(0)
    await shot(page, '15-s01-home-after-delete')
    expect(
      await page.evaluate(
        () => (window as unknown as { seen: { notFound: boolean } }).seen.notFound,
      ),
    ).toBe(false)
  })
})

/** Opens a main destination: the tab bar on a phone, the top navigation on desktop. */
async function openTab(page: Page, name: 'Home' | 'Find' | 'Alerts' | 'Account') {
  const desktop = (page.viewportSize()?.width ?? 0) >= 1024
  await page.getByRole(desktop ? 'link' : 'tab', { name, exact: true }).click()
}

test('shows Compare plans, the placeholder tabs and Account', async ({ page, email }) => {
  await toAllSet(page, email, await toCodeScreen(page, email))
  await toEmptyHome(page)

  await page.getByRole('button', { name: 'Compare plans', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Compare plans' })).toBeVisible()
  for (const plan of ['Free', 'Pro', 'Max']) {
    await expect(page.getByRole('heading', { name: plan, exact: true })).toBeVisible()
  }
  await expect(page.getByText('Your plan', { exact: true })).toBeVisible()
  await shot(page, '16-w06-compare-plans')
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your circle starts here' })).toBeVisible()

  await openTab(page, 'Find')
  await expect(
    page.getByRole('heading', { name: 'Scanning arrives in the next pilot build' }),
  ).toBeVisible()
  await shot(page, '17-find')
  await openTab(page, 'Alerts')
  await expect(
    page.getByRole('heading', { name: 'Alerts arrive in the next pilot build' }),
  ).toBeVisible()
  await shot(page, '18-alerts')
  await openTab(page, 'Account')
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible()
  await expect(page.getByText('Alex', { exact: true })).toBeVisible()
  await expect(page.getByText(email, { exact: true })).toBeVisible()
  await shot(page, '19-account')
})

test('asks for a new code when the code is refused (S05)', async ({ page, email }) => {
  const first = await toCodeScreen(page, email)
  // Wait for the first email to arrive, so it is in the inbox when the second is asked for.
  const firstCode = await latestCode(email, first)
  await page.getByTestId('code-input').fill(firstCode === '000000' ? '000001' : '000000')
  await expect(page.getByText('That code didn’t work')).toBeVisible()
  await shot(page, '20-s05-code-refused')

  // The new code is the one in the message that arrives after this point; the first email is
  // already in the inbox and cannot be mistaken for it. (Auth also replaces the first code, so
  // reading the old one here would send the test back to "That code didn't work".)
  const second = await markInbox(email)
  await page.getByRole('button', { name: 'Send a new code', exact: true }).click()
  await expect(page.getByText(`We sent a new code to ${email}.`)).toBeVisible()
  await page.getByTestId('code-input').fill(await latestCode(email, second))
  await expect(page.getByText('What should we call you?')).toBeVisible()
})

test('says so when the connection drops, and keeps drafts (S04)', async ({
  page,
  context,
  email,
}) => {
  await toAllSet(page, email, await toCodeScreen(page, email))
  await toEmptyHome(page)
  // Open the form while online: a web build loads each screen's code when it is first opened, so
  // a screen that has never been opened can't be opened offline.
  await page.getByRole('button', { name: 'Add my first pet', exact: true }).click()
  await expect(page.getByText('Let’s meet your pet')).toBeVisible()

  const banner = page
    .getByRole('status')
    .filter({ hasText: 'You’re offline. Saved information is available.' })
  await expect(banner).toHaveCount(0)

  // Chromium's offline mode, as DevTools sets it.
  await context.setOffline(true)
  await expect(banner).toBeVisible()
  // Adding a pet needs a connection: the form offers a draft first.
  await expect(page.getByRole('button', { name: 'Continue to photos', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Save as draft', exact: true })).toBeEnabled()
  await shot(page, '21-s04-add-pet-offline')

  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your circle starts here' })).toBeVisible()
  await expect(banner).toBeVisible()
  await shot(page, '22-s04-home-offline')

  await context.setOffline(false)
  await expect(banner).toHaveCount(0)
})
