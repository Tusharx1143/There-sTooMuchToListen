import { describe, it, expect } from 'vitest'
import { AtlasLayout, CELL_COLS, CELL_ROWS, SONGS_PER_CELL } from '../src/atlas/layout'

const COUNTRIES = ['us', 'br', 'ng']
const GENRES = [14, 18, 21]
const layout = new AtlasLayout(COUNTRIES, GENRES)

describe('AtlasLayout', () => {
  it('sizes the atlas from the axis lengths', () => {
    expect(layout.cols).toBe(3 * CELL_COLS)   // 15
    expect(layout.rows).toBe(3 * CELL_ROWS)   // 30
    expect(SONGS_PER_CELL).toBe(CELL_COLS * CELL_ROWS)
  })

  it('puts the first hex in the first country and first genre', () => {
    expect(layout.slotAt({ col: 0, row: 0 })).toEqual({ country: 'us', genre: 14, index: 0 })
  })

  it('changes country as you move horizontally', () => {
    expect(layout.slotAt({ col: CELL_COLS, row: 0 })?.country).toBe('br')
    expect(layout.slotAt({ col: 2 * CELL_COLS, row: 0 })?.country).toBe('ng')
  })

  it('changes genre as you move vertically', () => {
    expect(layout.slotAt({ col: 0, row: CELL_ROWS })?.genre).toBe(18)
    expect(layout.slotAt({ col: 0, row: 2 * CELL_ROWS })?.genre).toBe(21)
  })

  it('indexes songs row-major inside a cell', () => {
    expect(layout.slotAt({ col: 1, row: 0 })?.index).toBe(1)
    expect(layout.slotAt({ col: 0, row: 1 })?.index).toBe(CELL_COLS)
    expect(layout.slotAt({ col: CELL_COLS - 1, row: CELL_ROWS - 1 })?.index).toBe(SONGS_PER_CELL - 1)
  })

  it('returns null outside the atlas', () => {
    expect(layout.slotAt({ col: -1, row: 0 })).toBeNull()
    expect(layout.slotAt({ col: 0, row: -1 })).toBeNull()
    expect(layout.slotAt({ col: layout.cols, row: 0 })).toBeNull()
    expect(layout.slotAt({ col: 0, row: layout.rows })).toBeNull()
  })

  it('covers every hex exactly once, with no duplicate song slots', () => {
    const seen = new Set<string>()
    for (let col = 0; col < layout.cols; col++) {
      for (let row = 0; row < layout.rows; row++) {
        const slot = layout.slotAt({ col, row })
        expect(slot).not.toBeNull()
        const key = `${slot!.country}-${slot!.genre}-${slot!.index}`
        expect(seen.has(key)).toBe(false)
        seen.add(key)
      }
    }
    expect(seen.size).toBe(COUNTRIES.length * GENRES.length * SONGS_PER_CELL)
  })

  it('round-trips a cell origin back to that cell', () => {
    const origin = layout.cellOrigin({ country: 'br', genre: 18 })
    expect(origin).toEqual({ col: CELL_COLS, row: CELL_ROWS })
    const slot = layout.slotAt(origin!)
    expect(slot).toEqual({ country: 'br', genre: 18, index: 0 })
  })

  it('returns null for a cell outside the axes', () => {
    expect(layout.cellOrigin({ country: 'zz', genre: 14 })).toBeNull()
    expect(layout.cellOrigin({ country: 'us', genre: 9999 })).toBeNull()
  })
})
