import { describe, it, expect } from 'vitest'
import { tileTier, ART_MIN_PX, SOLID_MIN_PX, TILE_GAP } from '../src/render/tile'
import { speckleColor } from '../src/render/imageCache'

describe('tileTier', () => {
  it('picks a tier from the radial extent', () => {
    expect(tileTier(ART_MIN_PX)).toBe('art')
    expect(tileTier(ART_MIN_PX + 40)).toBe('art')
    expect(tileTier(ART_MIN_PX - 0.01)).toBe('solid')
    expect(tileTier(SOLID_MIN_PX)).toBe('solid')
    expect(tileTier(SOLID_MIN_PX - 0.01)).toBe('speck')
    expect(tileTier(0)).toBe('speck')
  })

  it('leaves a usable gap between tiles', () => {
    expect(TILE_GAP).toBeGreaterThan(0.8)
    expect(TILE_GAP).toBeLessThan(1)
  })
})

describe('speckleColor', () => {
  it('is deterministic', () => {
    expect(speckleColor(3, 7)).toBe(speckleColor(3, 7))
  })

  it('varies across the grid', () => {
    const seen = new Set<string>()
    for (let c = 0; c < 30; c++) for (let r = 0; r < 30; r++) seen.add(speckleColor(c, r))
    expect(seen.size).toBeGreaterThan(50)
  })

  it('returns a parseable hsl string', () => {
    expect(speckleColor(1, 1)).toMatch(/^hsl\(\d{1,3}, \d{1,3}%, \d{1,3}%\)$/)
  })

  it('is not symmetric under transposition', () => {
    let collisions = 0
    for (let a = 0; a < 40; a++) {
      for (let b = a + 1; b < 40; b++) {
        if (speckleColor(a, b) === speckleColor(b, a)) collisions++
      }
    }
    // 780 pairs spread over 360 hues, so a handful of chance matches is
    // expected. A hash symmetric in col/row would collide on all 780 and
    // stripe the field along the diagonal.
    expect(collisions).toBeLessThan(20)
  })
})
