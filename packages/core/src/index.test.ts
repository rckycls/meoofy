import { describe, expect, it } from 'vitest'
import * as core from './index'

describe('@meoofy/core', () => {
  it('exports a package marker', () => {
    expect(core.PACKAGE).toBe('@meoofy/core')
  })
})
