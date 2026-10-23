/**
 * Domain limits shared by the API client, the database parity check and the app.
 * Every value mirrors the spec; the database enforces the same numbers.
 */
export const LIMITS = {
  /** Pet name length, in Unicode code points after trimming (1..petNameMax). */
  petNameMax: 40,
  /** Breed/description length, in code points after trimming (0..breedMax). */
  breedMax: 80,
  /** Largest stored pet age, in whole months (`age_months` is 0..ageMonthsMax). */
  ageMonthsMax: 360,
  /** Largest value of the "years" field on the age form (0..ageYearsMax). */
  ageYearsMax: 30,
  /** Display name length, in code points after trimming (1..displayNameMax). */
  displayNameMax: 40,
  /** Most non-rejected photos per pet. */
  photosPerPet: 6,
  /** Largest accepted photo upload, in bytes (4 MiB). */
  photoMaxBytes: 4194304,
  /** Shortest accepted photo side, in pixels. */
  photoMinShortSide: 720,
  /** Long edge photos are resized to before upload, in pixels. */
  photoLongEdge: 1600,
  /** JPEG quality photos are encoded with (0..1). */
  photoJpegQuality: 0.8,
  /** Edge length of the grayscale copy used for the quality analysis, in pixels. */
  analysisSize: 512,
  /** Photos darker than this mean brightness are rejected. */
  brightnessMin: 40,
  /** Photos brighter than this mean brightness are rejected. */
  brightnessMax: 220,
  /** Photos with a Laplacian variance below this are rejected as blurry. */
  blurMin: 80,
  /** Photo upload requests allowed per user per rolling hour. */
  uploadsPerHour: 30,
  /** Lifetime of a signed photo URL, in seconds. */
  signedUrlSeconds: 3600,
  /** Pending photos older than this many hours are cleaned up. */
  pendingPhotoTtlHours: 24,
} as const

export type Limits = typeof LIMITS
