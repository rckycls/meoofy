import { LIMITS } from '@meoofy/core'

import type { PhotoProblem, PhotoState } from '../../data/usePhotoUpload'
import type { GuidedView } from '../../photo/views'

const views = {
  front: { title: 'Front', hint: 'Face the camera, with the whole face in view.' },
  side: { title: 'Side', hint: 'Show the side, so the full profile is in view.' },
  markings: { title: 'Markings', hint: 'Get close to patches, spots, scars or a collar tag.' },
} as const satisfies Record<GuidedView, { title: string; hint: string }>

/** What a screen reader says after the view's name; the visible words are in `status`. */
const stateLabels = {
  idle: 'not added',
  checking: 'checking',
  uploading: 'uploading',
  ready: 'ready',
  error: 'needs a new photo',
} as const satisfies Record<PhotoState, string>

/** English copy for the reference photo screen and the camera (O04, S02). */
export const photosCopy = {
  back: 'Back',
  title: 'A clearer photo helps',
  intro: (name: string) =>
    `Add a front, side and markings photo of ${name}. Only you can see these photos.`,
  loading: 'Loading photos',
  tips: {
    title: 'Photo tips',
    body: 'Use daylight. Keep the face and coat visible. Avoid filters and blurry photos.',
  },
  group: 'Reference photos',
  views,
  status: {
    idle: 'Not added yet',
    checking: 'Checking photo…',
    uploading: 'Uploading…',
    ready: 'Ready',
    error: 'Couldn’t add this photo',
    keptPrevious: 'Ready · earlier photo kept',
  },
  /** "Front photo, ready": the tile's name and state for assistive technology. */
  tileLabel: (view: GuidedView, state: PhotoState, keptPrevious: boolean) =>
    `${views[view].title} photo, ${keptPrevious ? 'ready, earlier photo kept' : stateLabels[state]}`,
  actions: {
    take: 'Take photo',
    retake: 'Retake photo',
    library: 'Choose from library',
    // The browser's own file chooser, which on a phone also offers the camera.
    upload: 'Upload photo',
    retry: 'Try again',
    testPhoto: 'Use test photo',
    done: 'Done',
    later: 'Finish later',
  },
  camera: {
    title: (view: GuidedView) => `${views[view].title} photo`,
    shutter: (view: GuidedView) => `Take ${views[view].title.toLowerCase()} photo`,
    cancel: 'Cancel',
    starting: 'Starting the camera',
    captureFailed: 'We couldn’t take that photo. Please try again.',
    // S02: the camera is off for Meoofy, so the library takes its place.
    off: {
      title: 'Camera access is off',
      body: 'Meoofy can’t use your camera right now. You can allow it in Settings, or add photos from your library instead.',
      upload: 'Upload photos instead',
      settings: 'Open Settings',
    },
    unavailable: {
      title: 'Camera isn’t available',
      body: 'Meoofy can’t start the camera on this device. You can add photos from your library instead.',
    },
  },
  problems: {
    BLURRY: 'That photo looks blurry — try again in better light',
    TOO_DARK: 'That photo is too dark — try again in daylight',
    TOO_BRIGHT: 'That photo is too bright — move out of the glare and try again',
    TOO_SMALL: `That photo is too small — use one that’s at least ${LIMITS.photoMinShortSide} pixels on its short side`,
    TOO_LARGE: 'That photo is too large to upload — try a different one',
    UNREADABLE: 'We couldn’t read that photo. Please try a different one.',
    // The server's check of the photo; the same guidance as the device's.
    PHOTO_QUALITY: 'That photo didn’t pass our quality check — try again in daylight',
    // Spec §9.
    RATE_LIMITED: 'Take a short break and try again',
    NETWORK: 'You seem to be offline. Check your connection and try again.',
    UNKNOWN: 'Something went wrong. Please try again.',
    // The server's photo limit (LIMITS.photosPerPet): sending the photo again can't help.
    PHOTO_LIMIT: 'This pet already has the most photos it can keep. Remove one to add another.',
    // Any other refused upload slot: this attempt can't be sent again, but the photo can be added
    // again as a new attempt.
    REFUSED: 'We couldn’t add that photo. Please add it again.',
  } satisfies Record<PhotoProblem, string>,
  // Shown while "Try again" waits after RATE_LIMITED (`RATE_LIMITED_RETRY_DELAY_MS`). No time is
  // promised: the server's limit is per rolling hour, so the retry after the wait may be limited
  // again.
  retryWait: 'Please wait a little, then try again.',
  loadFailed: 'We couldn’t load your photos. Please try again.',
  // Offline: the photo actions are off, and photos that were never loaded are not guessed at.
  offline: 'Photos need a connection',
  // The photo library, or the bundled test photo, could not be opened.
  sourceFailed: 'We couldn’t open your photos. Please try again.',
} as const
