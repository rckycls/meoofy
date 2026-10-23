import { LIMITS } from './limits'

export type PhotoMetrics = {
  /** Mean grayscale value, 0..255. */
  brightness: number
  /** Variance of the Laplacian; higher means sharper. */
  blurScore: number
}

export type PhotoRejection = 'TOO_SMALL' | 'TOO_DARK' | 'TOO_BRIGHT' | 'BLURRY'

export type PhotoAssessment = { ok: true } | { ok: false; reason: PhotoRejection }

/** 4-neighbour Laplacian at (x, y); callers keep (x, y) off the image border. */
function laplacian(pixels: Uint8Array, width: number, x: number, y: number): number {
  const i = y * width + x
  return 4 * pixels[i]! - pixels[i - width]! - pixels[i + width]! - pixels[i - 1]! - pixels[i + 1]!
}

/**
 * Measures a row-major 8-bit grayscale image.
 *
 * - `brightness` is the mean pixel value.
 * - `blurScore` is the variance of the 4-neighbour Laplacian
 *   (`4·p − up − down − left − right`) over interior pixels. An image with no
 *   interior pixels (a side under 3px) scores 0.
 *
 * @throws RangeError when width/height are not positive integers or do not
 * match `pixels.length`.
 */
export function analyzeGray(pixels: Uint8Array, width: number, height: number): PhotoMetrics {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    pixels.length !== width * height
  ) {
    throw new RangeError(
      `analyzeGray: ${width}x${height} does not match a buffer of ${pixels.length} pixels`,
    )
  }

  let sum = 0
  for (let i = 0; i < pixels.length; i++) sum += pixels[i]!
  const brightness = sum / pixels.length

  if (width < 3 || height < 3) return { brightness, blurScore: 0 }

  const count = (width - 2) * (height - 2)
  let lapSum = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) lapSum += laplacian(pixels, width, x, y)
  }
  const mean = lapSum / count

  // Two passes keep the variance exact enough for 512x512 inputs without
  // the cancellation error of E[x²] − E[x]².
  let squares = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const d = laplacian(pixels, width, x, y) - mean
      squares += d * d
    }
  }

  return { brightness, blurScore: squares / count }
}

/** Decides whether a photo is good enough to upload; checks run in a fixed order. */
export function assessPhoto(m: PhotoMetrics & { width: number; height: number }): PhotoAssessment {
  if (Math.min(m.width, m.height) < LIMITS.photoMinShortSide)
    return { ok: false, reason: 'TOO_SMALL' }
  if (m.brightness < LIMITS.brightnessMin) return { ok: false, reason: 'TOO_DARK' }
  if (m.brightness > LIMITS.brightnessMax) return { ok: false, reason: 'TOO_BRIGHT' }
  if (m.blurScore < LIMITS.blurMin) return { ok: false, reason: 'BLURRY' }
  return { ok: true }
}
