import { LIMITS } from '@pawpin/core'

/** English copy for sign-in, the email code and the name step. */
export const authCopy = {
  signIn: {
    title: 'Welcome to PawPin',
    body: 'Sign in with Apple or a 6-digit code sent to your email. There’s no password to remember.',
    apple: 'Continue with Apple',
    divider: 'or',
    emailLabel: 'Email',
    emailPlaceholder: 'you@example.com',
    emailAction: 'Sign in with email',
    emailInvalid: 'Enter a valid email address',
  },
  emailCode: {
    title: 'Check your email',
    body: (email: string) =>
      `We sent a 6-digit code to ${email}. If it doesn’t arrive, check your spam folder.`,
    codeLabel: '6-digit code',
    verify: 'Verify code',
    resend: 'Resend code',
    resendIn: (seconds: number) => `You can request a new code in ${seconds}s`,
    sentAgain: (email: string) => `We sent a new code to ${email}.`,
    differentEmail: 'Use a different email',
    // S05: the code was wrong or has expired; Auth does not say which.
    expired: {
      title: 'That code didn’t work',
      body: 'It may have expired, or a digit may be wrong. Send a new code and try again.',
      action: 'Send a new code',
    },
  },
  yourName: {
    title: 'What should we call you?',
    body: 'We’ll use it to greet you. You can change it later.',
    label: 'Your name',
    action: 'Continue',
    required: 'Enter your name',
    tooLong: `Use ${LIMITS.displayNameMax} characters or fewer`,
    // The same step opened from Account (`?mode=edit`) to change the name.
    edit: {
      title: 'Change your name',
      body: 'This is how we greet you in PawPin.',
      action: 'Save',
      cancel: 'Cancel',
    },
  },
  errors: {
    inviteOnly: 'This pilot is invite-only',
    // The link under the invite-only message, shown only when a support address is configured.
    contact: 'Email us to ask for an invite',
    rateLimited: 'Take a short break and try again',
    network: 'You seem to be offline. Check your connection and try again.',
    unknown: 'Something went wrong. Please try again.',
  },
} as const
