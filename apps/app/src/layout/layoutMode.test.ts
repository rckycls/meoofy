import { layoutModeFor } from './layoutMode'

describe('layoutModeFor', () => {
  it('switches at 768 and 1024', () => {
    expect(layoutModeFor(390)).toBe('mobile')
    expect(layoutModeFor(767)).toBe('mobile')
    expect(layoutModeFor(768)).toBe('mobile-centered')
    expect(layoutModeFor(1023)).toBe('mobile-centered')
    expect(layoutModeFor(1024)).toBe('desktop')
    expect(layoutModeFor(1440)).toBe('desktop')
  })
})
