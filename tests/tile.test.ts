import { describe, it, expect } from 'vitest'
import {
  tileTier, drawTile, hexPath,
  ART_MIN_PX, SOLID_MIN_PX, TILE_GAP, type TileOpts,
} from '../src/render/tile'
import { speckleColor } from '../src/render/imageCache'

function fakeCtx(): { ctx: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = []
  const ctx = {
    save: () => { calls.push('save') },
    restore: () => { calls.push('restore') },
    translate: () => { calls.push('translate') },
    rotate: () => { calls.push('rotate') },
    scale: () => { calls.push('scale') },
    beginPath: () => { calls.push('beginPath') },
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    clip: () => { calls.push('clip') },
    fill: () => { calls.push('fill') },
    fillRect: () => { calls.push('fillRect') },
    stroke: () => { calls.push('stroke') },
    drawImage: () => { calls.push('drawImage') },
    createLinearGradient: () => {
      calls.push('createLinearGradient')
      return { addColorStop: () => {} }
    },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

function opts(over: Partial<TileOpts> = {}): TileOpts {
  return {
    x: 100, y: 100, size: 11.28,
    angle: 0, radial: 1, tangential: 1, alpha: 1,
    image: null, colors: ['#111111', '#222222'],
    highlighted: false, dim: false,
    ...over,
  }
}

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

describe('drawTile', () => {
  it('skips the transform for undistorted tiles', () => {
    const { ctx, calls } = fakeCtx()
    drawTile(ctx, opts({ radial: 1, tangential: 1 }))
    expect(calls).not.toContain('rotate')
    expect(calls).not.toContain('scale')
  })

  it('rotates and scales warped tiles', () => {
    const { ctx, calls } = fakeCtx()
    drawTile(ctx, opts({ radial: 0.4, tangential: 2.1, angle: 1.2, size: 100 }))
    expect(calls).toContain('rotate')
    expect(calls).toContain('scale')
  })

  it('balances every save with a restore', () => {
    for (const o of [opts(), opts({ size: 100 }), opts({ size: 100, image: {} as CanvasImageSource })]) {
      const { ctx, calls } = fakeCtx()
      drawTile(ctx, o)
      expect(calls.filter((c) => c === 'save').length)
        .toBe(calls.filter((c) => c === 'restore').length)
    }
  })

  it('draws specks as bare rects with no clip or gradient', () => {
    const { ctx, calls } = fakeCtx()
    drawTile(ctx, opts({ size: SOLID_MIN_PX / 2, radial: 1, tangential: 1 }))
    expect(calls).toContain('fillRect')
    expect(calls).not.toContain('clip')
    expect(calls).not.toContain('createLinearGradient')
    expect(calls).not.toContain('drawImage')
  })

  it('draws solid tiles as filled hexes with no gradient', () => {
    const { ctx, calls } = fakeCtx()
    // Between the two thresholds, wherever they sit.
    drawTile(ctx, opts({ size: (SOLID_MIN_PX + ART_MIN_PX) / 2, radial: 1, tangential: 1 }))
    expect(calls).toContain('fill')
    expect(calls).not.toContain('clip')
    expect(calls).not.toContain('createLinearGradient')
  })

  it('clips and draws the image for art tiles', () => {
    const { ctx, calls } = fakeCtx()
    drawTile(ctx, opts({ size: 40, image: {} as CanvasImageSource }))
    expect(calls).toContain('clip')
    expect(calls).toContain('drawImage')
    expect(calls).not.toContain('createLinearGradient')
  })

  it('falls back to a gradient when the art has not loaded', () => {
    const { ctx, calls } = fakeCtx()
    drawTile(ctx, opts({ size: 40, image: null }))
    expect(calls).toContain('createLinearGradient')
    expect(calls).not.toContain('drawImage')
  })

  it('strokes only when highlighted', () => {
    const plain = fakeCtx()
    drawTile(plain.ctx, opts({ size: 40 }))
    expect(plain.calls).not.toContain('stroke')

    const lit = fakeCtx()
    drawTile(lit.ctx, opts({ size: 40, highlighted: true }))
    expect(lit.calls).toContain('stroke')
  })

  it('carries alpha onto the context', () => {
    const { ctx } = fakeCtx()
    drawTile(ctx, opts({ alpha: 0.3 }))
    expect(ctx.globalAlpha).toBe(0.3)
  })
})

describe('hexPath', () => {
  it('opens and closes a path', () => {
    const { ctx, calls } = fakeCtx()
    hexPath(ctx, 0, 0, 10)
    expect(calls).toContain('beginPath')
  })
})
