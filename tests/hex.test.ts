import { describe, it, expect } from 'vitest'
import {
  HEX_SIZE, offsetToAxial, axialToOffset, axialToPixel, pixelToAxial,
} from '../src/atlas/hex'

describe('hex coordinates', () => {
  it('round-trips offset → axial → offset, including negatives', () => {
    for (let col = -20; col <= 20; col++) {
      for (let row = -20; row <= 20; row++) {
        const back = axialToOffset(offsetToAxial({ col, row }))
        expect(back).toEqual({ col, row })
      }
    }
  })

  it('round-trips offset → pixel → offset (hit-testing correctness)', () => {
    for (let col = 0; col < 40; col++) {
      for (let row = 0; row < 40; row++) {
        const px = axialToPixel(offsetToAxial({ col, row }))
        const back = axialToOffset(pixelToAxial(px))
        expect(back).toEqual({ col, row })
      }
    }
  })

  it('places the origin hex at the pixel origin', () => {
    expect(axialToPixel({ q: 0, r: 0 })).toEqual({ x: 0, y: 0 })
  })

  it('spaces adjacent columns by sqrt(3) * size', () => {
    const a = axialToPixel(offsetToAxial({ col: 0, row: 0 }))
    const b = axialToPixel(offsetToAxial({ col: 1, row: 0 }))
    expect(b.x - a.x).toBeCloseTo(Math.sqrt(3) * HEX_SIZE, 6)
    expect(b.y - a.y).toBeCloseTo(0, 6)
  })

  it('offsets odd rows by half a column and stacks them 1.5*size apart', () => {
    const r0 = axialToPixel(offsetToAxial({ col: 0, row: 0 }))
    const r1 = axialToPixel(offsetToAxial({ col: 0, row: 1 }))
    expect(r1.x - r0.x).toBeCloseTo((Math.sqrt(3) / 2) * HEX_SIZE, 6)
    expect(r1.y - r0.y).toBeCloseTo(1.5 * HEX_SIZE, 6)
  })

  it('snaps a point near a hex centre to that hex', () => {
    const centre = axialToPixel(offsetToAxial({ col: 7, row: 5 }))
    const jittered = { x: centre.x + 3, y: centre.y - 4 }
    expect(axialToOffset(pixelToAxial(jittered))).toEqual({ col: 7, row: 5 })
  })
})
