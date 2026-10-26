import { ImageManipulator } from 'expo-image-manipulator'
import { LIMITS } from '@meoofy/core'

import { FIXTURE_SIZE, fixtureBase64, fixtureBytes, type FixtureName } from '../testing/fixtures'
import { preparePhoto, toGray, type Decode, type Manipulate } from './preparePhoto'

// The native manipulator is replaced at the module boundary; `preparePhoto`'s own deps are
// injected below, so only the default `manipulate` (the last describe) reaches this mock.
jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { JPEG: 'jpeg' },
}))

/** RGBA pixels as jpeg-js decodes them, with the colour at each pixel taken from `colour`. */
function rgba(width: number, height: number, colour: (x: number, y: number) => number[]) {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r = 0, g = r, b = r] = colour(x, y)
      data.set([r, g, b, 255], (y * width + x) * 4)
    }
  }
  return { width, height, data }
}

const flat = (width: number, height: number, level: number) => rgba(width, height, () => [level])
/** Single-pixel black and white squares: as much blur-free detail as an image can have. */
const checker = (width: number, height: number, low = 0, high = 255) =>
  rgba(width, height, (x, y) => [(x + y) % 2 === 0 ? low : high])

/** A fake `manipulate` that answers each call with the next image in `images`. */
function fakeManipulate(
  ...images: { width: number; height: number; bytes?: number | Uint8Array }[]
) {
  const calls: Parameters<Manipulate>[] = []
  const manipulate: Manipulate = async (...args) => {
    calls.push(args)
    const image = images[calls.length - 1] ?? images[images.length - 1]!
    const bytes =
      image.bytes instanceof Uint8Array
        ? image.bytes
        : new Uint8Array(image.bytes ?? 1000).fill(calls.length)
    return {
      uri: `file:///prepared-${calls.length}.jpg`,
      width: image.width,
      height: image.height,
      bytes,
    }
  }
  return { manipulate, calls }
}

/** A fake `decode` that returns `image` whatever it is given, and records what it was given. */
function fakeDecode(image: ReturnType<typeof rgba>) {
  const seen: Uint8Array[] = []
  const decode: Decode = (bytes) => {
    seen.push(bytes)
    return image
  }
  return { decode, seen }
}

describe('preparePhoto', () => {
  it('rejects a flat gray photo as BLURRY', async () => {
    const { manipulate } = fakeManipulate(
      { width: 1600, height: 1200 },
      { width: 512, height: 384 },
    )
    const { decode } = fakeDecode(flat(512, 384, 128))

    await expect(preparePhoto('file:///flat.jpg', { manipulate, decode })).resolves.toEqual({
      ok: false,
      reason: 'BLURRY',
    })
  })

  it('accepts a checker pattern at 1600x1200 and returns what it measured', async () => {
    const bytes = Uint8Array.from({ length: 5000 }, (_, i) => i % 251)
    const { manipulate } = fakeManipulate({ width: 1600, height: 1200, bytes })
    const { decode } = fakeDecode(checker(1600, 1200))

    const result = await preparePhoto('file:///checker.jpg', { manipulate, decode })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.width).toBe(1600)
    expect(result.height).toBe(1200)
    // Half the squares are black and half white.
    expect(result.brightness).toBeCloseTo(127.5, 5)
    expect(result.blurScore).toBeGreaterThan(LIMITS.blurMin)
    // The JPEG that is returned is exactly the encoded photo.
    expect(result.jpeg).toBeInstanceOf(ArrayBuffer)
    expect(new Uint8Array(result.jpeg)).toEqual(bytes)
  })

  it('returns the encoded bytes whole when they are a view into a larger buffer', async () => {
    const backing = new Uint8Array(100).map((_, i) => i)
    const bytes = backing.subarray(10, 30)
    const { manipulate } = fakeManipulate({ width: 1600, height: 1200, bytes })
    const { decode } = fakeDecode(checker(512, 384))

    const result = await preparePhoto('file:///view.jpg', { manipulate, decode })

    expect(result.ok && new Uint8Array(result.jpeg)).toEqual(bytes)
    expect(result.ok && result.jpeg.byteLength).toBe(20)
  })

  it('resizes to the long edge limit, then makes an analysis copy of the encoded photo', async () => {
    const encoded = new Uint8Array(2000).fill(7)
    const copy = new Uint8Array(900).fill(9)
    const { manipulate, calls } = fakeManipulate(
      { width: 1600, height: 1200, bytes: encoded },
      { width: 512, height: 384, bytes: copy },
    )
    const { decode, seen } = fakeDecode(checker(512, 384))

    await preparePhoto('file:///original.jpg', { manipulate, decode })

    expect(calls).toEqual([
      ['file:///original.jpg', LIMITS.photoLongEdge, LIMITS.photoJpegQuality],
      ['file:///prepared-1.jpg', LIMITS.analysisSize, LIMITS.photoJpegQuality],
    ])
    // Only the small copy is decoded; the 1600 px photo never is.
    expect(seen).toEqual([copy])
  })

  it('rejects a photo whose encoded size is over the limit as TOO_LARGE, and accepts one at it', async () => {
    const { decode } = fakeDecode(checker(512, 384))

    const over = fakeManipulate({ width: 1600, height: 1200, bytes: LIMITS.photoMaxBytes + 1 })
    await expect(
      preparePhoto('file:///big.jpg', { manipulate: over.manipulate, decode }),
    ).resolves.toEqual({ ok: false, reason: 'TOO_LARGE' })

    const exactly = fakeManipulate({ width: 1600, height: 1200, bytes: LIMITS.photoMaxBytes })
    await expect(
      preparePhoto('file:///edge.jpg', { manipulate: exactly.manipulate, decode }),
    ).resolves.toMatchObject({ ok: true })
  })

  it('rejects a photo whose short side is under the minimum as TOO_SMALL, and accepts one at it', async () => {
    const { decode } = fakeDecode(checker(512, 384))

    const small = fakeManipulate({ width: 1200, height: LIMITS.photoMinShortSide - 1 })
    await expect(
      preparePhoto('file:///small.jpg', { manipulate: small.manipulate, decode }),
    ).resolves.toEqual({ ok: false, reason: 'TOO_SMALL' })

    // It is the short side that counts, whichever way the photo is held.
    const upright = fakeManipulate({ width: LIMITS.photoMinShortSide - 1, height: 1200 })
    await expect(
      preparePhoto('file:///upright.jpg', { manipulate: upright.manipulate, decode }),
    ).resolves.toEqual({ ok: false, reason: 'TOO_SMALL' })

    const exactly = fakeManipulate({ width: 1200, height: LIMITS.photoMinShortSide })
    await expect(
      preparePhoto('file:///edge.jpg', { manipulate: exactly.manipulate, decode }),
    ).resolves.toMatchObject({ ok: true })
  })

  it.each([
    ['dark', 0, 20, 'TOO_DARK'],
    ['bright', 235, 255, 'TOO_BRIGHT'],
  ])('rejects a %s photo as %s', async (_name, low, high, reason) => {
    const { manipulate } = fakeManipulate({ width: 1600, height: 1200 })
    const { decode } = fakeDecode(checker(512, 384, low, high))

    await expect(preparePhoto('file:///x.jpg', { manipulate, decode })).resolves.toEqual({
      ok: false,
      reason,
    })
  })

  it('measures brightness on the grayscale copy with the 0.299 / 0.587 / 0.114 weights', async () => {
    // Red and blue squares: plain averaging would give 85, the weighted gray gives (76 + 29) / 2.
    const { manipulate } = fakeManipulate({ width: 1600, height: 1200 })
    const redBlue = rgba(512, 384, (x, y) => ((x + y) % 2 === 0 ? [255, 0, 0] : [0, 0, 255]))

    const result = await preparePhoto('file:///rb.jpg', {
      manipulate,
      decode: fakeDecode(redBlue).decode,
    })

    expect(result.ok && result.brightness).toBe(52.5)
  })

  it('lets a failure to read the photo through, so the caller can say it could not be read', async () => {
    const unreadable = async () => {
      throw new Error('corrupted image')
    }
    await expect(
      preparePhoto('file:///broken.jpg', {
        manipulate: unreadable,
        decode: fakeDecode(flat(1, 1, 0)).decode,
      }),
    ).rejects.toThrow('corrupted image')

    const { manipulate } = fakeManipulate({ width: 1600, height: 1200 })
    await expect(
      preparePhoto('file:///broken.jpg', {
        manipulate,
        decode: () => {
          throw new Error('SOI not found')
        },
      }),
    ).rejects.toThrow('SOI not found')
  })
})

describe('toGray', () => {
  it('weights red, green and blue by 0.299, 0.587 and 0.114 and ignores alpha', () => {
    const pixels = new Uint8Array([
      ...[255, 0, 0, 255], // red
      ...[0, 255, 0, 255], // green
      ...[0, 0, 255, 255], // blue
      ...[255, 255, 255, 0], // white, fully transparent
      ...[0, 0, 0, 255], // black
    ])

    expect(Array.from(toGray(pixels))).toEqual([76, 150, 29, 255, 0])
  })

  it('returns one 8-bit value per pixel', () => {
    const gray = toGray(new Uint8Array(4 * 6))

    expect(gray).toBeInstanceOf(Uint8Array)
    expect(gray).toHaveLength(6)
  })
})

describe('the real manipulator and decoder', () => {
  /** The native manipulator, answering each load of `file:///<name>.jpg` with that fixture. */
  function useFixtures() {
    const manipulate = jest.mocked(ImageManipulator.manipulate)
    const saves: unknown[] = []
    manipulate.mockImplementation(((uri: string) => ({
      release: jest.fn(),
      renderAsync: async () => ({
        release: jest.fn(),
        saveAsync: async (options: unknown) => {
          saves.push(options)
          const name = /\/(\w+)\.jpg/.exec(uri)?.[1] as FixtureName
          return { uri: `${uri}#out`, ...FIXTURE_SIZE, base64: fixtureBase64(name) }
        },
      }),
    })) as never)
    return { manipulate, saves }
  }

  it('bounds the photo to the long edge limit, encodes it as JPEG at the quality limit, and measures the decoded copy', async () => {
    const { manipulate, saves } = useFixtures()

    const result = await preparePhoto('file:///front.jpg')

    // Loading with a bound downsamples while decoding and never upscales a smaller photo.
    expect(manipulate.mock.calls).toEqual([
      ['file:///front.jpg', { maxWidth: LIMITS.photoLongEdge, maxHeight: LIMITS.photoLongEdge }],
      ['file:///front.jpg#out', { maxWidth: LIMITS.analysisSize, maxHeight: LIMITS.analysisSize }],
    ])
    expect(saves).toEqual([
      { format: 'jpeg', compress: LIMITS.photoJpegQuality, base64: true },
      { format: 'jpeg', compress: LIMITS.photoJpegQuality, base64: true },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(new Uint8Array(result.jpeg)).toEqual(fixtureBytes('front'))
    expect(result.width).toBe(FIXTURE_SIZE.width)
    expect(result.height).toBe(FIXTURE_SIZE.height)
    expect(result.blurScore).toBeGreaterThan(LIMITS.blurMin)
  })

  it('releases the native image and context after the photo is made', async () => {
    const release = { context: jest.fn(), image: jest.fn() }
    jest.mocked(ImageManipulator.manipulate).mockImplementation((() => ({
      release: release.context,
      renderAsync: async () => ({
        release: release.image,
        saveAsync: async () => ({
          uri: 'file:///out.jpg',
          ...FIXTURE_SIZE,
          base64: fixtureBase64('front'),
        }),
      }),
    })) as never)

    await preparePhoto('file:///front.jpg')

    // One context and one image for the photo, and the same for its analysis copy.
    expect(release.context).toHaveBeenCalledTimes(2)
    expect(release.image).toHaveBeenCalledTimes(2)
  })

  it('releases the context when the image cannot be rendered', async () => {
    const release = jest.fn()
    jest.mocked(ImageManipulator.manipulate).mockImplementation((() => ({
      release,
      renderAsync: async () => {
        throw new Error('corrupt image')
      },
    })) as never)

    await expect(preparePhoto('file:///corrupt.jpg')).rejects.toThrow('corrupt image')

    expect(release).toHaveBeenCalledTimes(1)
  })

  it('releases the context and the image when the image cannot be saved', async () => {
    const release = { context: jest.fn(), image: jest.fn() }
    jest.mocked(ImageManipulator.manipulate).mockImplementation((() => ({
      release: release.context,
      renderAsync: async () => ({
        release: release.image,
        saveAsync: async () => {
          throw new Error('disk full')
        },
      }),
    })) as never)

    await expect(preparePhoto('file:///front.jpg')).rejects.toThrow('disk full')

    expect(release.context).toHaveBeenCalledTimes(1)
    expect(release.image).toHaveBeenCalledTimes(1)
  })

  // Task 24 uploads these files too: they must keep their intended verdicts.
  it.each([
    ['front', { ok: true }],
    ['side', { ok: true }],
    ['markings', { ok: true }],
    ['blurry', { ok: false, reason: 'BLURRY' }],
  ])('gives the %s fixture its intended verdict', async (name, verdict) => {
    useFixtures()

    await expect(preparePhoto(`file:///${name}.jpg`)).resolves.toMatchObject(verdict)
  })
})
