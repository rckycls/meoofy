import { describe, expect, it } from 'vitest'
import { LIMITS } from './limits'

describe('LIMITS', () => {
  it('holds every value from the spec', () => {
    expect(LIMITS).toEqual({
      petNameMax: 40,
      breedMax: 80,
      ageMonthsMax: 360,
      ageYearsMax: 30,
      displayNameMax: 40,
      photosPerPet: 6,
      photoMaxBytes: 4194304,
      photoMinShortSide: 720,
      photoLongEdge: 1600,
      photoJpegQuality: 0.8,
      analysisSize: 512,
      brightnessMin: 40,
      brightnessMax: 220,
      blurMin: 80,
      uploadsPerHour: 30,
      signedUrlSeconds: 3600,
      pendingPhotoTtlHours: 24,
    })
  })

  it('keeps the age bounds consistent', () => {
    expect(LIMITS.ageYearsMax * 12).toBe(LIMITS.ageMonthsMax)
  })
})
