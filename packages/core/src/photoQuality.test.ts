import { describe, expect, it } from 'vitest'
import { analyzeGray, assessPhoto } from './photoQuality'

describe('analyzeGray', () => {
  it('reports the mean as brightness and zero blur for a flat image', () => {
    const flat = new Uint8Array(64 * 64).fill(128)
    expect(analyzeGray(flat, 64, 64)).toEqual({ brightness: 128, blurScore: 0 })
  })

  it('scores a sharp checkerboard far above the blur threshold', () => {
    const checker = Uint8Array.from({ length: 64 * 64 }, (_, i) =>
      ((i % 64) + Math.floor(i / 64)) % 2 ? 255 : 0,
    )
    expect(analyzeGray(checker, 64, 64).blurScore).toBeGreaterThan(80)
  })

  it('scores a smooth gradient below the blur threshold', () => {
    const w = 64
    const h = 64
    const gradient = Uint8Array.from({ length: w * h }, (_, i) =>
      Math.floor(((i % w) / (w - 1)) * 255),
    )
    expect(analyzeGray(gradient, w, h).blurScore).toBeLessThan(80)
  })

  it('computes the variance of the 4-neighbour Laplacian over interior pixels', () => {
    // A single bright pixel at the centre of a 3x3 image has one interior
    // pixel: 4*255 - 0 = 1020. One sample means zero variance.
    const dot = new Uint8Array(9)
    dot[4] = 255
    expect(analyzeGray(dot, 3, 3).blurScore).toBe(0)

    // 4x3: two interior pixels (row 1, cols 1..2). Row 1 = [0, 10, 0, 0],
    // rows 0 and 2 are zero. lap(1,1) = 40 - 0 - 0 - 0 - 0 = 40,
    // lap(1,2) = 0 - 0 - 0 - 10 - 0 = -10. Mean 15, variance 625.
    const px = new Uint8Array(12)
    px[5] = 10
    expect(analyzeGray(px, 4, 3).blurScore).toBe(625)
    expect(analyzeGray(px, 4, 3).brightness).toBe(10 / 12)
  })

  it('reports zero blur when the image has no interior pixels', () => {
    expect(analyzeGray(new Uint8Array([0, 255, 0, 255]), 2, 2).blurScore).toBe(0)
    expect(analyzeGray(new Uint8Array([10, 20, 30]), 3, 1)).toEqual({
      brightness: 20,
      blurScore: 0,
    })
  })

  it('rejects dimensions that do not match the pixel buffer', () => {
    expect(() => analyzeGray(new Uint8Array(10), 4, 4)).toThrow(RangeError)
    expect(() => analyzeGray(new Uint8Array(0), 0, 0)).toThrow(RangeError)
    expect(() => analyzeGray(new Uint8Array(4), 2.5, 1.6)).toThrow(RangeError)
  })
})

describe('assessPhoto', () => {
  it('rejects photos whose short side is under 720px', () => {
    expect(assessPhoto({ brightness: 120, blurScore: 200, width: 1600, height: 719 })).toEqual({
      ok: false,
      reason: 'TOO_SMALL',
    })
    expect(assessPhoto({ brightness: 120, blurScore: 200, width: 719, height: 1600 })).toEqual({
      ok: false,
      reason: 'TOO_SMALL',
    })
  })

  it('rejects photos darker than 40', () => {
    expect(assessPhoto({ brightness: 39, blurScore: 200, width: 1600, height: 1200 })).toEqual({
      ok: false,
      reason: 'TOO_DARK',
    })
  })

  it('rejects photos brighter than 220', () => {
    expect(assessPhoto({ brightness: 221, blurScore: 200, width: 1600, height: 1200 })).toEqual({
      ok: false,
      reason: 'TOO_BRIGHT',
    })
  })

  it('rejects photos with a blur score under 80', () => {
    expect(assessPhoto({ brightness: 120, blurScore: 79.9, width: 1600, height: 1200 })).toEqual({
      ok: false,
      reason: 'BLURRY',
    })
  })

  it('accepts photos exactly on every limit', () => {
    expect(assessPhoto({ brightness: 40, blurScore: 80, width: 1200, height: 720 })).toEqual({
      ok: true,
    })
    expect(assessPhoto({ brightness: 220, blurScore: 80, width: 720, height: 1200 })).toEqual({
      ok: true,
    })
  })

  it('reports the first failing check in size, dark, bright, blur order', () => {
    expect(assessPhoto({ brightness: 0, blurScore: 0, width: 100, height: 100 }).ok).toBe(false)
    expect(assessPhoto({ brightness: 0, blurScore: 0, width: 100, height: 100 })).toEqual({
      ok: false,
      reason: 'TOO_SMALL',
    })
    expect(assessPhoto({ brightness: 0, blurScore: 0, width: 1000, height: 1000 })).toEqual({
      ok: false,
      reason: 'TOO_DARK',
    })
    expect(assessPhoto({ brightness: 255, blurScore: 0, width: 1000, height: 1000 })).toEqual({
      ok: false,
      reason: 'TOO_BRIGHT',
    })
  })
})
