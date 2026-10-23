/// <reference types="node" />
// Reads the committed end-to-end fixtures (apps/app/e2e/fixtures, made by `pnpm gen:fixtures`) from
// disk for tests. This is the only file that needs Node's types; the app itself never does.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type FixtureName = 'front' | 'side' | 'markings' | 'blurry'

/** The pixel size of every fixture: a portrait photo, short side 768. */
export const FIXTURE_SIZE = { width: 768, height: 1024 } as const

const cache = new Map<FixtureName, Buffer>()

function read(name: FixtureName): Buffer {
  let bytes = cache.get(name)
  if (bytes === undefined) {
    bytes = readFileSync(join(__dirname, '../../e2e/fixtures', `${name}.jpg`))
    cache.set(name, bytes)
  }
  return bytes
}

/** The fixture's bytes. */
export function fixtureBytes(name: FixtureName): Uint8Array {
  return new Uint8Array(read(name))
}

/** The fixture's bytes as base64, the way the image manipulator returns an image. */
export function fixtureBase64(name: FixtureName): string {
  return read(name).toString('base64')
}

/** Whether `actual` holds exactly the bytes of the fixture `name`. */
export function isFixture(actual: ArrayBuffer | Uint8Array, name: FixtureName): boolean {
  return read(name).equals(actual instanceof Uint8Array ? actual : new Uint8Array(actual))
}

/** The fixture a file name refers to (`file:///library/a/front.jpg#prepared` is `front`), if any. */
export function fixtureNamed(uri: string): FixtureName | undefined {
  const name = /([^/#?]+)\.jpg(?:[#?].*)?$/.exec(uri)?.[1]
  return name === 'front' || name === 'side' || name === 'markings' || name === 'blurry'
    ? name
    : undefined
}
