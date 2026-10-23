import { describe, expect, it } from 'vitest'
import { formatAge, toAgeMonths } from './age'

describe('toAgeMonths', () => {
  it('converts years and months to total months', () => {
    expect(toAgeMonths(3)).toBe(36)
    expect(toAgeMonths(2, 3)).toBe(27)
    expect(toAgeMonths(0, 0)).toBe(0)
    expect(toAgeMonths(0, 11)).toBe(11)
    expect(toAgeMonths(30)).toBe(360)
  })

  it('rejects years above 30', () => {
    expect(() => toAgeMonths(31)).toThrow()
  })

  it('rejects months outside 0-11', () => {
    expect(() => toAgeMonths(1, 12)).toThrow()
    expect(() => toAgeMonths(1, -1)).toThrow()
  })

  it('rejects a total above 360 months', () => {
    expect(() => toAgeMonths(30, 1)).toThrow()
  })

  it('rejects negative, fractional and non-finite input', () => {
    expect(() => toAgeMonths(-1)).toThrow()
    expect(() => toAgeMonths(1.5)).toThrow()
    expect(() => toAgeMonths(1, 0.5)).toThrow()
    expect(() => toAgeMonths(Number.NaN)).toThrow()
    expect(() => toAgeMonths(Number.POSITIVE_INFINITY)).toThrow()
  })
})

describe('formatAge', () => {
  it('formats whole years', () => {
    expect(formatAge(36)).toBe('3 years')
    expect(formatAge(12)).toBe('1 year')
  })

  it('formats years and months', () => {
    expect(formatAge(14)).toBe('1 year 2 months')
    expect(formatAge(25)).toBe('2 years 1 month')
  })

  it('formats months only', () => {
    expect(formatAge(5)).toBe('5 months')
    expect(formatAge(1)).toBe('1 month')
  })

  it('formats a newborn and an unknown age', () => {
    expect(formatAge(0)).toBe('0 months')
    expect(formatAge(null)).toBe('')
  })
})
