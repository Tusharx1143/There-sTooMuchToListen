import { describe, it, expect } from 'vitest'
import { AtlasLayout, CELL_COLS, CELL_ROWS } from '../src/atlas/layout'
import { visibleOffsets, requiredCellKeys, clampView } from '../src/atlas/viewport'
import { axialToPixel, offsetToAxial, HEX_SIZE } from '../src/atlas/hex'

const layout = new AtlasLayout(['us', 'br', 'ng', 'jp'], [14, 18, 21])

describe('visibleOffsets', () => {
  it('includes the hex at the top-left of the view', () => {
    const range = visibleOffsets({ x: 0, y: 0, w: 400, h: 300 }, layout)
    expect(range.colMin).toBe(0)
    expect(range.rowMin).toBe(0)
  })

  it('never returns offsets outside the atlas', () => {
    const range = visibleOffsets({ x: -1000, y: -1000, w: 200, h: 200 }, layout)
    expect(range.colMin).toBeGreaterThanOrEqual(0)
    expect(range.rowMin).toBeGreaterThanOrEqual(0)
    expect(range.colMax).toBeLessThan(layout.cols)
    expect(range.rowMax).toBeLessThan(layout.rows)
  })

  it('covers every hex whose centre lies inside the view', () => {
    const view = { x: 120, y: 90, w: 500, h: 400 }
    const range = visibleOffsets(view, layout)
    for (let col = 0; col < layout.cols; col++) {
      for (let row = 0; row < layout.rows; row++) {
        const p = axialToPixel(offsetToAxial({ col, row }))
        const inside =
          p.x >= view.x && p.x <= view.x + view.w && p.y >= view.y && p.y <= view.y + view.h
        if (inside) {
          expect(col).toBeGreaterThanOrEqual(range.colMin)
          expect(col).toBeLessThanOrEqual(range.colMax)
          expect(row).toBeGreaterThanOrEqual(range.rowMin)
          expect(row).toBeLessThanOrEqual(range.rowMax)
        }
      }
    }
  })
})

describe('requiredCellKeys', () => {
  it('returns the visible cell plus a one-cell prefetch ring', () => {
    // A tiny view parked inside the second country / second genre cell.
    const p = axialToPixel(offsetToAxial({ col: CELL_COLS + 2, row: CELL_ROWS + 5 }))
    const keys = requiredCellKeys({ x: p.x, y: p.y, w: 1, h: 1 }, layout, 1)
    expect(keys).toContain('br-18')     // the visible cell
    expect(keys).toContain('us-18')     // ring: west
    expect(keys).toContain('ng-18')     // ring: east
    expect(keys).toContain('br-14')     // ring: north
    expect(keys).toContain('br-21')     // ring: south
    expect(keys).not.toContain('jp-18') // two cells east — outside the ring
  })

  it('returns unique keys', () => {
    const keys = requiredCellKeys({ x: 0, y: 0, w: 2000, h: 2000 }, layout, 1)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('does not invent cells beyond the axes', () => {
    const keys = requiredCellKeys({ x: 0, y: 0, w: 50, h: 50 }, layout, 1)
    for (const k of keys) {
      const [country, genre] = k.split('-')
      expect(layout.countries).toContain(country)
      expect(layout.genres).toContain(Number(genre))
    }
  })
})

describe('clampView', () => {
  it('stops panning past the north-west corner', () => {
    const p = clampView({ x: -500, y: -500, w: 300, h: 300 }, layout)
    expect(p.x).toBe(0)
    expect(p.y).toBe(0)
  })

  it('stops panning past the south-east corner', () => {
    const p = clampView({ x: 1e6, y: 1e6, w: 300, h: 300 }, layout)
    expect(p.x).toBeCloseTo(layout.widthPx - 300, 6)
    expect(p.y).toBeCloseTo(layout.heightPx - 300, 6)
  })

  it('leaves a view that already fits alone', () => {
    const p = clampView({ x: 40, y: 30, w: 200, h: 150 }, layout)
    expect(p).toEqual({ x: 40, y: 30 })
  })
})
