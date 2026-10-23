export const onboardingCopy = {
  brand: 'PawPin',
  welcome: {
    title: 'Every pet deserves a way home.',
    body: 'Register your dog or cat once. Their details stay private until the day you need help.',
    chips: ['Private by default', 'Scan without signup', 'Recovery on every plan'],
    primary: 'Get started',
    secondary: 'I found a pet',
  },
  choosePath: {
    title: 'How would you like to help?',
    body: 'Choose a path now. You can switch anytime in Account.',
    owner: { title: 'Protect my pet', body: 'Private profile, ready if they wander.' },
    finder: { title: 'Help a found pet', body: 'Scan a photo. No account needed.' },
    primary: 'Continue',
    secondary: 'Back',
  },
  privacy: {
    title: 'Helpful in public. Private by default.',
    body: 'Three promises we keep for every pet and every finder.',
    promises: [
      'Owners choose what finders see.',
      'Contact stays inside PawPin.',
      'No account needed to scan.',
    ],
    primary: 'Sounds good',
    secondary: 'Back',
  },
  allSet: {
    body: 'Add your first pet. It takes about two minutes and stays private.',
    card: { title: 'Add a dog or cat', body: 'Photos, name and a few details' },
    primary: 'Add my first pet',
    secondary: 'Explore PawPin',
  },
} as const

/** The O03 headline. A blank or unknown name leaves the greeting without one. */
export function allSetTitle(name: string | null | undefined): string {
  const trimmed = name?.trim() ?? ''
  return trimmed === '' ? 'You’re all set.' : `You’re all set, ${trimmed}.`
}
