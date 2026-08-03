import { describe, it, expect } from 'vitest'
import { COUNTRIES, GENRES } from '../harvest/taxonomy'
import { cellKey, SCHEMA_VERSION } from '../harvest/types'

describe('taxonomy', () => {
  it('has exactly 40 countries, all unique lowercase ISO-3166 alpha-2', () => {
    expect(COUNTRIES).toHaveLength(40)
    expect(new Set(COUNTRIES).size).toBe(40)
    for (const c of COUNTRIES) expect(c).toMatch(/^[a-z]{2}$/)
  })

  it('has exactly 30 genres with unique numeric ids and English labels', () => {
    expect(GENRES).toHaveLength(30)
    expect(new Set(GENRES.map((g) => g.id)).size).toBe(30)
    for (const g of GENRES) {
      expect(Number.isInteger(g.id)).toBe(true)
      expect(g.label.length).toBeGreaterThan(0)
    }
  })

  it('builds a stable cell key', () => {
    expect(cellKey('br', 1122)).toBe('br-1122')
  })

  it('pins the schema version', () => {
    expect(SCHEMA_VERSION).toBe(1)
  })
})
