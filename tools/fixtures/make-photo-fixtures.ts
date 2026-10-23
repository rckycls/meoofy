// Writes the reference-photo fixtures in apps/app/e2e/fixtures: front.jpg, side.jpg and
// markings.jpg, which pass the on-device quality check, and blurry.jpg, which fails it as BLURRY.
// Run with `pnpm gen:fixtures`. The output is deterministic, so a rerun changes no bytes.
//
// The app bundles these files for its "Use test photo" button (E2E builds), and Task 24's device
// tests upload them. After writing, the script reads each file back and measures it with the
// same `analyzeGray` and `assessPhoto` the app uses, and fails unless it gets its intended verdict.
//
// Node runs this file directly (type stripping), so it uses only erasable syntax. Core's sources
// use extensionless relative imports (bundler style), which Node's resolver does not accept, so a
// resolve hook retries those specifiers with `.ts`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { decode, encode } from 'jpeg-js'

registerHooks({
  resolve(specifier, context, nextResolve) {
    const extensionless = specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)
    return nextResolve(extensionless ? `${specifier}.ts` : specifier, context)
  },
})

const { LIMITS } = await import('../../packages/core/src/limits.ts')
const { analyzeGray, assessPhoto } = await import('../../packages/core/src/photoQuality.ts')

const OUTPUT = fileURLToPath(new URL('../../apps/app/e2e/fixtures/', import.meta.url))

// A phone's portrait photo, scaled down. The short side is above LIMITS.photoMinShortSide and at
// most MAX_SHORT_SIDE (Ruling 41), since Metro bundles the files into every build.
const WIDTH = 768
const HEIGHT = 1024
const MAX_SHORT_SIDE = 800
/** JPEG quality of the fixtures themselves (the app's own encoding is LIMITS.photoJpegQuality). */
const JPEG_QUALITY = 80

type Rgb = readonly [number, number, number]
type Scene = { sky: Rgb; ground: Rgb; seed: number; accents: readonly Rgb[] }

/** Each view has its own colours and seed, so the three thumbnails are told apart on screen. */
const SCENES = {
  front: {
    sky: [214, 172, 120],
    ground: [96, 120, 168],
    seed: 11,
    accents: [
      [250, 220, 150],
      [70, 52, 40],
      [200, 90, 70],
      [240, 240, 235],
    ],
  },
  side: {
    sky: [150, 190, 140],
    ground: [120, 96, 70],
    seed: 23,
    accents: [
      [245, 235, 210],
      [60, 80, 60],
      [220, 150, 60],
      [40, 40, 50],
    ],
  },
  markings: {
    sky: [200, 160, 190],
    ground: [70, 90, 110],
    seed: 37,
    accents: [
      [255, 245, 230],
      [90, 50, 70],
      [60, 130, 150],
      [230, 200, 80],
    ],
  },
} as const satisfies Record<string, Scene>

type Expected = { ok: true } | { ok: false; reason: 'BLURRY' }
const FIXTURES: readonly { name: string; scene: Scene; blur: boolean; expected: Expected }[] = [
  { name: 'front', scene: SCENES.front, blur: false, expected: { ok: true } },
  { name: 'side', scene: SCENES.side, blur: false, expected: { ok: true } },
  { name: 'markings', scene: SCENES.markings, blur: false, expected: { ok: true } },
  // The front scene, blurred until nothing sharp is left; its brightness is still in range.
  { name: 'blurry', scene: SCENES.front, blur: true, expected: { ok: false, reason: 'BLURRY' } },
]

/** A small seeded generator (mulberry32), so the images never change between runs. */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))

type Pixels = { width: number; height: number; data: Uint8Array }

/** RGBA pixels: a sky-to-ground gradient, many hard-edged shapes, and fine grain. */
function paint(scene: Scene): Pixels {
  const next = random(scene.seed)
  const data = new Uint8Array(WIDTH * HEIGHT * 4)
  for (let y = 0; y < HEIGHT; y++) {
    const t = y / (HEIGHT - 1)
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4
      for (let c = 0; c < 3; c++) {
        data[i + c] = clamp(scene.sky[c]! * (1 - t) + scene.ground[c]! * t)
      }
      data[i + 3] = 255
    }
  }

  const shapes = 70
  for (let n = 0; n < shapes; n++) {
    const colour = scene.accents[Math.floor(next() * scene.accents.length)]!
    const round = next() < 0.5
    const w = 30 + next() * 150
    const h = 30 + next() * 150
    const left = next() * WIDTH - w / 2
    const top = next() * HEIGHT - h / 2
    for (let y = Math.max(0, Math.floor(top)); y < Math.min(HEIGHT, Math.ceil(top + h)); y++) {
      for (let x = Math.max(0, Math.floor(left)); x < Math.min(WIDTH, Math.ceil(left + w)); x++) {
        if (round) {
          const dx = (x - left) / w - 0.5
          const dy = (y - top) / h - 0.5
          if (dx * dx + dy * dy > 0.25) continue
        }
        const i = (y * WIDTH + x) * 4
        data[i] = colour[0]
        data[i + 1] = colour[1]
        data[i + 2] = colour[2]
      }
    }
  }

  // Grain, like a camera's, so even flat areas have some texture.
  const grain = 10
  for (let i = 0; i < data.length; i += 4) {
    const g = (next() - 0.5) * 2 * grain
    data[i] = clamp(data[i]! + g)
    data[i + 1] = clamp(data[i + 1]! + g)
    data[i + 2] = clamp(data[i + 2]! + g)
  }
  return { width: WIDTH, height: HEIGHT, data }
}

/** Blurs RGBA pixels in place: `passes` box blurs of the given radius, rows then columns. */
function blur(image: Pixels, radius: number, passes: number): void {
  const { width, height, data } = image
  const line = new Float32Array(Math.max(width, height) * 3)
  const run = (length: number, start: number, step: number) => {
    for (let c = 0; c < 3; c++) {
      let sum = 0
      let count = 0
      for (let k = 0; k <= Math.min(radius, length - 1); k++) {
        sum += data[start + k * step + c]!
        count++
      }
      for (let k = 0; k < length; k++) {
        line[k * 3 + c] = sum / count
        const add = k + radius + 1
        const drop = k - radius
        if (add < length) {
          sum += data[start + add * step + c]!
          count++
        }
        if (drop >= 0) {
          sum -= data[start + drop * step + c]!
          count--
        }
      }
    }
    for (let k = 0; k < length; k++) {
      for (let c = 0; c < 3; c++) data[start + k * step + c] = clamp(line[k * 3 + c]!)
    }
  }
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < height; y++) run(width, y * width * 4, 4)
    for (let x = 0; x < width; x++) run(height, x * 4, width * 4)
  }
}

/** The grayscale formula the app uses: 0.299 R + 0.587 G + 0.114 B. */
function toGray(rgba: Uint8Array): Uint8Array {
  const gray = new Uint8Array(rgba.length / 4)
  for (let i = 0; i < gray.length; i++) {
    gray[i] = Math.round(0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!)
  }
  return gray
}

/** The grayscale image scaled (box filter) so its long edge is LIMITS.analysisSize. */
function analysisCopy(gray: Uint8Array, width: number, height: number): Pixels {
  const scale = Math.min(1, LIMITS.analysisSize / Math.max(width, height))
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y / scale)
    const y1 = Math.max(y0 + 1, Math.min(height, Math.ceil((y + 1) / scale)))
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x / scale)
      const x1 = Math.max(x0 + 1, Math.min(width, Math.ceil((x + 1) / scale)))
      let sum = 0
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) sum += gray[yy * width + xx]!
      out[y * w + x] = Math.round(sum / ((y1 - y0) * (x1 - x0)))
    }
  }
  return { width: w, height: h, data: out }
}

/** Reads a written file back and returns what the app's quality check would say about it. */
function verdictFor(file: string) {
  const bytes = readFileSync(file)
  const image = decode(bytes, { useTArray: true, formatAsRGBA: true })
  const copy = analysisCopy(toGray(image.data), image.width, image.height)
  const metrics = analyzeGray(copy.data, copy.width, copy.height)
  return {
    bytes: bytes.byteLength,
    width: image.width,
    height: image.height,
    metrics,
    assessment: assessPhoto({ ...metrics, width: image.width, height: image.height }),
  }
}

function fail(message: string): never {
  throw new Error(`make-photo-fixtures: ${message}`)
}

mkdirSync(OUTPUT, { recursive: true })

for (const { name, scene, blur: blurred, expected } of FIXTURES) {
  const image = paint(scene)
  if (blurred) blur(image, 18, 3)

  const file = `${OUTPUT}${name}.jpg`
  writeFileSync(file, encode(image, JPEG_QUALITY).data)

  const { bytes, width, height, metrics, assessment } = verdictFor(file)
  const summary = `${name}.jpg ${width}x${height}, ${bytes} bytes, brightness ${metrics.brightness.toFixed(1)}, blur ${metrics.blurScore.toFixed(1)}`

  const shortSide = Math.min(width, height)
  if (shortSide < LIMITS.photoMinShortSide || shortSide > MAX_SHORT_SIDE) {
    fail(`${summary}: the short side must be ${LIMITS.photoMinShortSide}..${MAX_SHORT_SIDE} px`)
  }
  if (bytes > LIMITS.photoMaxBytes) fail(`${summary}: over LIMITS.photoMaxBytes`)
  if (
    assessment.ok !== expected.ok ||
    (!assessment.ok && !expected.ok && assessment.reason !== expected.reason)
  ) {
    fail(`${summary}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(assessment)}`)
  }
  console.log(`${summary} -> ${JSON.stringify(assessment)}`)
}
