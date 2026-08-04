import { describe, it, expect } from 'vitest'
import {
  tileTier, drawTile, hexPath, reliefAt,
  ART_MIN_PX, RELIEF_FIELD_SCALE, SOLID_MIN_PX, TILE_GAP, type TileOpts,
} from '../src/render/tile'
import { speckleColor } from '../src/render/imageCache'

function fakeCtx(): { ctx: CanvasRenderingContext2D; calls: string[]; stops: string[] } {
  const calls: string[] = []
  const stops: string[] = []
  const gradient = { addColorStop: (_at: number, color: string) => { stops.push(color) } }
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
      return gradient
    },
    createRadialGradient: () => {
      calls.push('createRadialGradient')
      return gradient
    },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, stops }
}

function opts(over: Partial<TileOpts> = {}): TileOpts {
  return {
    x: 100, y: 100, size: 11.28,
    angle: 0, radial: 1, tangential: 1, alpha: 1, wash: null,
    image: null, colors: ['#111111', '#222222'],
    highlighted: false, dim: false, highlightColor: '#ffffff', relief: 0,
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

  /**
   * The `depth` preset's stand-in for the reference's raymarched height field:
   * a body gradient, a bevelled edge and a sunken face, all inside the tile's
   * own clip.
   */
  it('adds no relief passes under the minimal preset', () => {
    const { ctx, calls } = fakeCtx()
    drawTile(ctx, opts({ size: 40, image: {} as CanvasImageSource, relief: 0 }))
    expect(calls).not.toContain('createLinearGradient')
    expect(calls).not.toContain('createRadialGradient')
    expect(calls).not.toContain('stroke')
  })

  it('shades, bevels and sinks the tile under the depth preset', () => {
    const { ctx, calls } = fakeCtx()
    drawTile(ctx, opts({ size: 40, image: {} as CanvasImageSource, relief: 1 }))
    expect(calls).toContain('createLinearGradient')  // body + bevel
    expect(calls).toContain('createRadialGradient')  // the well
    expect(calls.filter((c) => c === 'stroke')).toHaveLength(1)
  })

  /**
   * The bevel is a stroke centred on the hex edge, so half of it falls outside
   * the path. Only a clip turns that into an inward-facing bevel face — without
   * one it would spill over the neighbouring tiles instead.
   */
  it('clips before it bevels', () => {
    const { ctx, calls } = fakeCtx()
    drawTile(ctx, opts({ size: 40, image: {} as CanvasImageSource, relief: 1 }))
    expect(calls.indexOf('clip')).toBeGreaterThan(-1)
    expect(calls.indexOf('clip')).toBeLessThan(calls.indexOf('stroke'))
  })

  /**
   * Relief is boosted toward the lens centre, so the strength reaching the
   * shading can exceed 1. `rgba()` with an alpha over 1 is not a valid colour —
   * browsers drop the whole declaration and the pass silently disappears.
   */
  it('keeps every relief alpha inside rgba()\'s range', () => {
    const { ctx, stops } = fakeCtx()
    drawTile(ctx, opts({ size: 40, image: {} as CanvasImageSource, relief: 4 }))
    expect(stops.length).toBeGreaterThan(0)
    for (const c of stops) {
      const alpha = Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(c)?.[1] ?? '0')
      expect(alpha, `${c} is out of range`).toBeLessThanOrEqual(1)
    }
  })

  it('reliefs solid tiles too, so the field does not change texture mid-lens', () => {
    const flat = fakeCtx()
    drawTile(flat.ctx, opts({ size: (SOLID_MIN_PX + ART_MIN_PX) / 2, relief: 0 }))
    expect(flat.calls).not.toContain('stroke')

    const lit = fakeCtx()
    drawTile(lit.ctx, opts({ size: (SOLID_MIN_PX + ART_MIN_PX) / 2, relief: 1 }))
    expect(lit.calls).toContain('stroke')
  })

  it('still balances every save with a restore under relief', () => {
    const { ctx, calls } = fakeCtx()
    drawTile(ctx, opts({ size: 40, image: {} as CanvasImageSource, relief: 1, wash: '#fff', alpha: 0.5 }))
    expect(calls.filter((c) => c === 'save').length)
      .toBe(calls.filter((c) => c === 'restore').length)
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

/**
 * The reference scales its whole raymarch by distance from the centre force,
 * so the height field is deepest under the cursor. This is that ramp.
 */
describe('reliefAt', () => {
  const K = 2

  it('stays flat under the minimal preset', () => {
    expect(reliefAt(0, 3, K)).toBe(0)
  })

  it('gives the focal tile the full strength', () => {
    expect(reliefAt(1, K + 1, K)).toBeCloseTo(1)
  })

  it('holds the field at its floor', () => {
    expect(reliefAt(1, 1, K)).toBeCloseTo(RELIEF_FIELD_SCALE)
  })

  /**
   * The cached field and the live disc meet where magnification is exactly 1.
   * If the ramp did not land on the field's own value there, the lens rim would
   * show as a ring of changing texture.
   */
  it('meets the cached field at the lens rim without a step', () => {
    const rim = reliefAt(1, 1, K)
    const justInside = reliefAt(1, 1.0001, K)
    expect(Math.abs(justInside - rim)).toBeLessThan(0.001)
  })

  it('rises monotonically with magnification', () => {
    let previous = -1
    for (let mag = 1; mag <= K + 1; mag += 0.25) {
      const next = reliefAt(1, mag, K)
      expect(next).toBeGreaterThan(previous)
      previous = next
    }
  })

  /** `lens: off` means k is 0, and the ramp has nowhere to run. */
  it('survives a lens with no magnification at all', () => {
    expect(reliefAt(1, 1, 0)).toBeCloseTo(RELIEF_FIELD_SCALE)
  })
})
