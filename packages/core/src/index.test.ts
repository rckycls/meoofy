import { describe, expect, it } from 'vitest'
import * as core from './index'

describe('@pawpin/core', () => {
  it('exports a package marker', () => {
    expect(core.PACKAGE).toBe('@pawpin/core')
  })
})
