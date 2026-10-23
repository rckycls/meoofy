import { LIMITS } from '@pawpin/core'

const petCount = (count: number) => `${count} ${count === 1 ? 'pet' : 'pets'}`

/** English copy for adding, editing and viewing a pet (O03, O05). */
export const petsCopy = {
  back: 'Back',
  add: {
    title: 'Let’s meet your pet',
    step: 'Step 1 of 3 · Basics',
    action: 'Continue to photos',
    saveDraft: 'Save as draft',
    draftSaved: 'Draft saved on this device. Come back any time to finish.',
    draftFailed: 'We couldn’t save the draft. Please try again.',
    privacy: {
      title: 'Only you can see this',
      body: 'Registration never makes a pet publicly searchable.',
    },
  },
  edit: {
    title: (name: string) => `Edit ${name}`,
    action: 'Save changes',
  },
  fields: {
    name: 'Pet’s name',
    species: 'Species',
    breed: 'Breed or description',
    age: 'Age',
    ageHint: 'An estimate is fine. Leave both empty if you’re not sure.',
    years: 'Years',
    months: 'Months',
  },
  species: { dog: 'Dog', cat: 'Cat' },
  errors: {
    nameRequired: 'Give your pet a name',
    nameTooLong: `Use ${LIMITS.petNameMax} characters or fewer`,
    breedTooLong: `Use ${LIMITS.breedMax} characters or fewer`,
    yearsWhole: 'Enter whole years, like 3',
    yearsTooOld: `Age must be ${LIMITS.ageYearsMax} years or less`,
    monthsWhole: 'Enter whole months, fewer than a full year',
  },
  problems: {
    offline: 'You seem to be offline. Check your connection and try again.',
    validation: 'Please check the details above and try again.',
    unknown: 'Something went wrong. Please try again.',
  },
  /** Shown when the server refuses another pet because the plan is full. */
  limit: {
    title: 'Free plan limit reached',
    body: (limit: number | null) =>
      limit === null
        ? 'You’ve reached the most pets the Free plan allows.'
        : `You’ve added ${petCount(limit)}, the most the Free plan allows.`,
    comparePlans: 'Compare plans',
  },
  profile: {
    loading: 'Loading your pet',
    discovery: {
      title: 'Discovery Off',
      notSearchable: (name: string) => `${name} is not searchable.`,
      detail: 'Only an approved missing report can make recovery details discoverable.',
    },
    photos: 'Add reference photos',
    edit: 'Edit',
    delete: 'Delete pet',
    reportMissing: (name: string) => `Report ${name} missing`,
    notFound: {
      title: 'We couldn’t find this pet',
      body: 'It may have been deleted.',
      home: 'Back to Home',
    },
    errors: {
      loadFailed: 'We couldn’t load this pet. Please try again.',
      retry: 'Try again',
      delete: (name: string) => `We couldn’t delete ${name}. Please try again.`,
    },
    deleteDialog: {
      title: (name: string) => `Delete ${name}?`,
      body: (name: string) =>
        `This permanently deletes ${name} and their reference photos. It can’t be undone.`,
      confirm: (name: string) => `Yes, delete ${name}`,
      cancel: 'Cancel',
    },
  },
} as const
