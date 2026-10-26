// makeTestJpeg must produce a photo the app's own quality check accepts, measured the way the app
// measures it (spec §7: a 512px grayscale copy), or the upload tests would test a photo no user
// could send. No network: this runs in the unit project.
import { analyzeGray, assessPhoto, LIMITS } from '@meoofy/core'
import jpeg from 'jpeg-js'
import { describe, expect, it } from 'vitest'
import { makeTestJpeg } from './helpers'

/** Decodes a JPEG to 8-bit luma (BT.601), as a camera pipeline's grayscale copy would be. */
function decodeGray(bytes: ArrayBuffer): { pixels: Uint8Array; width: number; height: number } {
  const { data, width, height } = jpeg.decode(new Uint8Array(bytes), {
    useTArray: true,
    formatAsRGBA: true,
  })
  const pixels = new Uint8Array(width * height)
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = Math.round(
      0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!,
    )
  }
  return { pixels, width, height }
}

/** Box-filter resize to size×size, the analysis copy's shape (LIMITS.analysisSize). */
function resizeGray(src: Uint8Array, width: number, height: number, size: number): Uint8Array {
  const out = new Uint8Array(size * size)
  for (let ty = 0; ty < size; ty++) {
    const y0 = Math.floor((ty * height) / size)
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * height) / size))
    for (let tx = 0; tx < size; tx++) {
      const x0 = Math.floor((tx * width) / size)
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * width) / size))
      let sum = 0
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += src[y * width + x]!
      out[ty * size + tx] = Math.round(sum / ((y1 - y0) * (x1 - x0)))
    }
  }
  return out
}

describe('makeTestJpeg', () => {
  it.each([
    [1600, 1200],
    [LIMITS.photoMinShortSide, LIMITS.photoMinShortSide],
  ])('a %ix%i image decodes to that size and passes assessPhoto', (width, height) => {
    const bytes = makeTestJpeg(width, height)
    expect(bytes).toBeInstanceOf(ArrayBuffer)
    expect(bytes.byteLength).toBeLessThan(LIMITS.photoMaxBytes)

    const gray = decodeGray(bytes)
    expect([gray.width, gray.height]).toEqual([width, height])

    const size = LIMITS.analysisSize
    const metrics = analyzeGray(resizeGray(gray.pixels, width, height, size), size, size)
    expect(metrics.brightness).toBeGreaterThan(LIMITS.brightnessMin)
    expect(metrics.brightness).toBeLessThan(LIMITS.brightnessMax)
    expect(metrics.blurScore).toBeGreaterThan(LIMITS.blurMin)
    expect(assessPhoto({ ...metrics, width, height })).toEqual({ ok: true })
  })

  it('is deterministic: the same arguments give the same bytes, another seed different ones', () => {
    const bytes = (seed?: number) => Buffer.from(makeTestJpeg(800, 800, seed))
    expect(bytes().equals(bytes())).toBe(true)
    expect(bytes(1).equals(bytes())).toBe(true)
    expect(bytes(7).equals(bytes(7))).toBe(true)
    expect(bytes(7).equals(bytes(1))).toBe(false)
  })
})
