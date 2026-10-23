/** English copy for the Account tab. */
export const accountCopy = {
  title: 'Account',
  name: {
    label: 'Name',
    edit: 'Edit name',
    loading: 'Loading your name',
    notSet: 'Not set',
    unavailable: 'Couldn’t load your name',
    // Offline with no saved profile.
    offline: 'Not available offline',
  },
  email: { label: 'Email', none: 'No email on file' },
  signOut: 'Sign out',
  deleteAccount: 'Delete account',
  deleteOffline: 'Deleting your account needs a connection',
  deleteDialog: {
    title: 'Delete your account?',
    body: 'This permanently deletes your account, your pets and their photos. It can’t be undone.',
    confirm: 'Yes, delete my account',
    cancel: 'Cancel',
  },
  errors: {
    signOut: 'Something went wrong. Please try again.',
    delete: 'We couldn’t delete your account. Please try again.',
    offline: 'You seem to be offline. Check your connection and try again.',
  },
} as const
