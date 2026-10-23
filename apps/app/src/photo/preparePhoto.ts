import {
  ImageManipulator,
  SaveFormat,
  type ImageManipulatorContext,
  type ImageRef,
} from 'expo-image-manipulator'
import { decode as decodeJpeg } from 'jpeg-js'
import { analyzeGray, assessPhoto, LIMITS, type PhotoRejection } from '@pawpin/core'

/** What the device measured on a photo it is ready to upload. */
export type PreparedPhoto = {
  /** The JPEG to upload: its long edge is at most LIMITS.photoLongEdge. */
  jpeg: ArrayBuffer
  width: number
  height: number
  brightness: number
  blurScore: number
}

/** Why a photo can't be uploaded: the device's quality check, or the size limit. */
export type PreparedRejection = PhotoRejection | 'TOO_LARGE'

export type PrepareResult =
  ({ ok: true } & PreparedPhoto) | { ok: false; reason: PreparedRejection }

/** A JPEG that was made from a photo. */
export type EncodedImage = { uri: string; width: number; height: number; bytes: Uint8Array }

/**
 * Makes a JPEG of the image at `uri` whose long edge is at most `longEdge` px, at `quality` (0..1).
 * A smaller image keeps its size: it is never scaled up.
 */
export type Manipulate = (uri: string, longEdge: number, quality: number) => Promise<EncodedImage>

/** Decodes a JPEG to RGBA, four bytes per pixel, row by row. */
export type Decode = (jpeg: Uint8Array) => { width: number; height: number; data: Uint8Array }

function bytesFromBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const manipulateWithExpo: Manipulate = async (uri, longEdge, quality) => {
  let context: ImageManipulatorContext | undefined
  let image: ImageRef | undefined
  try {
    // A bound given when the image is loaded makes the decoder downsample it, so a 48-megapixel
    // photo is never held in memory whole, and it keeps the aspect ratio, bakes in the EXIF
    // orientation and leaves a smaller image alone. The same call turns HEIC (iOS) or a PNG into
    // JPEG.
    context = ImageManipulator.manipulate(uri, { maxWidth: longEdge, maxHeight: longEdge })
    image = await context.renderAsync()
    const saved = await image.saveAsync({
      format: SaveFormat.JPEG,
      compress: quality,
      base64: true,
    })
    if (saved.base64 === undefined) throw new Error('the image manipulator returned no data')
    return {
      uri: saved.uri,
      width: saved.width,
      height: saved.height,
      bytes: bytesFromBase64(saved.base64),
    }
  } finally {
    // Free the decoded bitmaps now rather than whenever the garbage collector gets to them, on
    // every path: a corrupt image fails in `renderAsync`, with only the context to release.
    image?.release()
    context?.release()
  }
}

const decodeWithJpegJs: Decode = (jpeg) => decodeJpeg(jpeg, { useTArray: true, formatAsRGBA: true })

/** Grayscale from RGBA, `0.299 R + 0.587 G + 0.114 B` per pixel; alpha is ignored. */
export function toGray(rgba: Uint8Array): Uint8Array {
  const gray = new Uint8Array(rgba.length / 4)
  for (let i = 0; i < gray.length; i++) {
    const p = i * 4
    gray[i] = Math.round(0.299 * rgba[p]! + 0.587 * rgba[p + 1]! + 0.114 * rgba[p + 2]!)
  }
  return gray
}

/** An ArrayBuffer holding exactly `bytes` (which may be a view into a larger buffer). */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/**
 * Gets a photo ready to upload, on the device:
 * 1. resizes it so its long edge is at most `LIMITS.photoLongEdge` and encodes it as JPEG at
 *    `LIMITS.photoJpegQuality`;
 * 2. makes a copy of that JPEG with a long edge of `LIMITS.analysisSize` and decodes it;
 * 3. converts the copy to grayscale and measures its brightness and sharpness (`analyzeGray`);
 * 4. judges it (`assessPhoto`), then its encoded size.
 *
 * A photo that fails a check comes back as `{ ok: false, reason }`. A photo that can't be read at
 * all (corrupt, or not an image) makes the returned promise reject.
 *
 * Every number comes from `LIMITS`. `deps` are the native image calls, for tests.
 */
export async function preparePhoto(
  uri: string,
  deps: { manipulate?: Manipulate; decode?: Decode } = {},
): Promise<PrepareResult> {
  const { manipulate = manipulateWithExpo, decode = decodeWithJpegJs } = deps

  const photo = await manipulate(uri, LIMITS.photoLongEdge, LIMITS.photoJpegQuality)
  // The measurements are taken on a small copy of the JPEG that will be uploaded.
  const copy = await manipulate(photo.uri, LIMITS.analysisSize, LIMITS.photoJpegQuality)
  const pixels = decode(copy.bytes)
  const metrics = analyzeGray(toGray(pixels.data), pixels.width, pixels.height)

  const assessment = assessPhoto({ ...metrics, width: photo.width, height: photo.height })
  if (!assessment.ok) return assessment
  if (photo.bytes.byteLength > LIMITS.photoMaxBytes) return { ok: false, reason: 'TOO_LARGE' }

  return {
    ok: true,
    jpeg: toArrayBuffer(photo.bytes),
    width: photo.width,
    height: photo.height,
    ...metrics,
  }
}
