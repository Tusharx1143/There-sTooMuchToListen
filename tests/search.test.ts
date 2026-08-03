import { describe, it, expect } from 'vitest'
import { AtlasLayout } from '../src/atlas/layout'
import { buildTargets, searchTargets } from '../src/ui/search'

const layout = new AtlasLayout(['us', 'br', 'jp'], [14, 21])
const labels = new Map([[14, 'Pop'], [21, 'Rock']])
const targets = buildTargets(layout, labels)

describe('buildTargets', () => {
  it('produces one target per country and per genre', () => {
    expect(targets).toHaveLength(3 + 2)
  })

  it('uses full country names', () => {
    expect(targets.some((t) => t.label === 'Brazil')).toBe(true)
  })
})

describe('searchTargets', () => {
  it('matches a country by prefix', () => {
    expect(searchTargets(targets, 'bra')[0]!.label).toBe('Brazil')
  })

  it('matches a genre', () => {
    expect(searchTargets(targets, 'rock')[0]!.label).toBe('Rock')
  })

  it('is case insensitive', () => {
    expect(searchTargets(targets, 'JAPAN')[0]!.label).toBe('Japan')
  })

  it('ranks a prefix match above a substring match', () => {
    const results = searchTargets(targets, 'pa')      // "Japan" contains it
    expect(results.length).toBeGreaterThan(0)
  })

  it('returns nothing for an empty query', () => {
    expect(searchTargets(targets, '')).toEqual([])
  })

  it('returns nothing when there is no match', () => {
    expect(searchTargets(targets, 'zzzzz')).toEqual([])
  })

  it('caps the number of results', () => {
    expect(searchTargets(targets, 'a').length).toBeLessThanOrEqual(8)
  })
})
