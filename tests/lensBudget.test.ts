import { describe, it, expect } from 'vitest'
import { HEX_SIZE, axialToPixel, offsetToAxial } from '../src/atlas/hex'
import { makeLens, transformTile } from '../src/render/lens'
import { tileTier, TILE_GAP, ART_MIN_PX } from '../src/render/tile'
import { IMAGE_CACHE_CAPACITY } from '../src/render/imageCache'
import { HEX_SIZE_BY_TILE, LENS_K_BY_PRESET } from '../src/state/settings'

const W = 1920
const H = 1080

/**
 * Walks a full 1920x1080 screenful the same way AtlasRenderer.draw does and
 * counts what each tile costs us. Counts, not wall-clock timings, so the
 * result is deterministic under jsdom.
 */
function survey(): { total: number; warped: number; art: number } {
  const lens = makeLens(W / 2, H / 2)
  const size = HEX_SIZE * TILE_GAP
  const cols = Math.ceil(W / (Math.sqrt(3) * HEX_SIZE)) + 4
  const rows = Math.ceil(H / (1.5 * HEX_SIZE)) + 4

  let total = 0
  let warped = 0
  let art = 0

  for (let row = -2; row < rows; row++) {
    for (let col = -2; col < cols; col++) {
      const t = transformTile(axialToPixel(offsetToAxial({ col, row })), lens)
      if (t.x < 0 || t.x > W || t.y < 0 || t.y > H) continue
      total++
      if (t.radial !== 1 || t.tangential !== 1) warped++
      if (tileTier(size * t.radial) === 'art') art++
    }
  }
  return { total, warped, art }
}

describe('lens constant budgets at 1920x1080', () => {
  const s = survey()

  it('fills the screen with cover-sized tiles', () => {
    expect(s.total).toBeGreaterThan(150)
    expect(s.total).toBeLessThan(600)
  })

  /**
   * The point of the sizing: no part of the field is too small to show its own
   * cover, including the compressed rim just inside the lens.
   */
  it('carries art on every visible tile', () => {
    expect(s.art).toBe(s.total)
  })

  /**
   * radialScale bottoms out at 1/(k+1) just inside the edge. A tile that dips
   * under ART_MIN_PX there shows a flat ring against the art around it — and
   * both operands are now user-settable, so every combination has to clear it,
   * not just the defaults.
   */
  it('keeps the tightest tile above the art threshold at every setting', () => {
    for (const hex of Object.values(HEX_SIZE_BY_TILE)) {
      for (const k of Object.values(LENS_K_BY_PRESET)) {
        expect(
          (hex * TILE_GAP) / (k + 1),
          `hexSize ${hex} with lens k ${k} falls under ART_MIN_PX`,
        ).toBeGreaterThan(ART_MIN_PX)
      }
    }
  })

  /** The smallest tiles put the most covers on screen — the cache's worst case. */
  it('keeps even the densest setting inside the image cache', () => {
    const smallest = Math.min(...Object.values(HEX_SIZE_BY_TILE))
    const perScreen =
      Math.ceil(W / (Math.sqrt(3) * smallest)) * Math.ceil(H / (1.5 * smallest))
    expect(perScreen).toBeLessThan(IMAGE_CACHE_CAPACITY)
  })

  /**
   * A screenful of covers is the resident set. If it ever exceeded capacity,
   * one field repaint would evict images the next repaint still needs, and the
   * two would refetch each other's tiles forever.
   */
  it('keeps a screenful of images inside the cache', () => {
    expect(s.art).toBeGreaterThan(0)
    expect(s.art).toBeLessThan(IMAGE_CACHE_CAPACITY)
  })

  /**
   * This is the number that predicts frame cost. The undistorted remainder is
   * served from the cached field canvas, so only the warped tiles are redrawn
   * as the lens moves — the common case by far.
   */
  it('keeps the per-frame transformed tile count affordable', () => {
    expect(s.warped).toBeGreaterThan(0)
    expect(s.warped).toBeLessThan(150)
    // And it must stay a small slice of the field, or the cache buys nothing.
    expect(s.warped).toBeLessThan(s.total / 3)
  })
})
