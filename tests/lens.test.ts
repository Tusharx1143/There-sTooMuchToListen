import { describe, it, expect } from 'vitest'
import {
  makeLens, lensRadius, radialScale, tangentialScale, brightness,
  transformTile, unlensPoint, easeCentre,
  LENS_RADIUS, LENS_K, BRIGHT_MIN,
} from '../src/render/lens'

const lens = makeLens(500, 400)
const D = LENS_RADIUS
const K = LENS_K

describe('lensRadius', () => {
  it('pins the centre and the edge', () => {
    expect(lensRadius(0, lens)).toBeCloseTo(0, 9)
    expect(lensRadius(D, lens)).toBeCloseTo(D, 9)
  })

  it('is identity beyond the edge', () => {
    expect(lensRadius(D + 1, lens)).toBe(D + 1)
    expect(lensRadius(5000, lens)).toBe(5000)
  })

  it('pushes every interior point outward, monotonically', () => {
    let prev = 0
    for (let d = 1; d < D; d += 3) {
      const f = lensRadius(d, lens)
      expect(f).toBeGreaterThanOrEqual(d)
      expect(f).toBeGreaterThan(prev)
      prev = f
    }
  })
})

describe('scales', () => {
  it('magnifies by k+1 at the centre', () => {
    expect(radialScale(0, lens)).toBeCloseTo(K + 1, 9)
    expect(tangentialScale(0, lens)).toBeCloseTo(K + 1, 9)
  })

  it('compresses radially but not tangentially at the edge', () => {
    expect(radialScale(D, lens)).toBeCloseTo(1, 9)
    expect(tangentialScale(D, lens)).toBeCloseTo(1, 9)
    expect(radialScale(D - 0.001, lens)).toBeCloseTo(1 / (K + 1), 4)
    expect(tangentialScale(D - 0.001, lens)).toBeCloseTo(1, 4)
  })

  it('never lets the radial scale exceed the tangential one', () => {
    for (let d = 0; d <= D; d += 5) {
      expect(radialScale(d, lens)).toBeLessThanOrEqual(tangentialScale(d, lens) + 1e-12)
    }
  })

  it('is undistorted outside the lens', () => {
    expect(radialScale(D + 50, lens)).toBe(1)
    expect(tangentialScale(D + 50, lens)).toBe(1)
  })
})

describe('brightness', () => {
  it('is full at the centre and floors outside', () => {
    expect(brightness(0, lens)).toBeCloseTo(1, 9)
    expect(brightness(D, lens)).toBeCloseTo(BRIGHT_MIN, 9)
    expect(brightness(D * 3, lens)).toBeCloseTo(BRIGHT_MIN, 9)
  })

  it('decreases monotonically', () => {
    let prev = Infinity
    for (let d = 0; d <= D; d += 5) {
      const b = brightness(d, lens)
      expect(b).toBeLessThanOrEqual(prev)
      prev = b
    }
  })
})

describe('transformTile', () => {
  it('is finite and unrotated at the exact centre', () => {
    const t = transformTile({ x: lens.cx, y: lens.cy }, lens)
    expect(t.x).toBeCloseTo(lens.cx, 9)
    expect(t.y).toBeCloseTo(lens.cy, 9)
    expect(t.angle).toBe(0)
    expect(t.radial).toBeCloseTo(K + 1, 9)
    expect(t.tangential).toBeCloseTo(K + 1, 9)
    expect(Number.isFinite(t.brightness)).toBe(true)
  })

  it('keeps the displaced point on the ray from the centre', () => {
    const p = { x: lens.cx + 120, y: lens.cy + 90 }
    const t = transformTile(p, lens)
    expect(Math.atan2(t.y - lens.cy, t.x - lens.cx)).toBeCloseTo(Math.atan2(90, 120), 9)
  })
})

describe('unlensPoint', () => {
  it('round-trips the forward transform', () => {
    for (let dx = -600; dx <= 600; dx += 37) {
      for (let dy = -600; dy <= 600; dy += 53) {
        const p = { x: lens.cx + dx, y: lens.cy + dy }
        const t = transformTile(p, lens)
        const back = unlensPoint({ x: t.x, y: t.y }, lens)
        expect(back.x).toBeCloseTo(p.x, 6)
        expect(back.y).toBeCloseTo(p.y, 6)
      }
    }
  })

  it('leaves the centre and the far field alone', () => {
    expect(unlensPoint({ x: lens.cx, y: lens.cy }, lens)).toEqual({ x: lens.cx, y: lens.cy })
    const far = { x: lens.cx + D + 200, y: lens.cy }
    expect(unlensPoint(far, lens)).toEqual(far)
  })
})

describe('easeCentre', () => {
  it('moves toward the target without overshooting', () => {
    const c = easeCentre({ x: 0, y: 0 }, { x: 100, y: 0 }, 16, 90)
    expect(c.x).toBeGreaterThan(0)
    expect(c.x).toBeLessThan(100)
  })

  it('converges', () => {
    let c = { x: 0, y: 0 }
    for (let i = 0; i < 200; i++) c = easeCentre(c, { x: 100, y: 50 }, 16, 90)
    expect(c.x).toBeCloseTo(100, 4)
    expect(c.y).toBeCloseTo(50, 4)
  })

  it('is frame-rate independent', () => {
    const target = { x: 100, y: 0 }
    const one = easeCentre({ x: 0, y: 0 }, target, 32, 90)
    const two = easeCentre(easeCentre({ x: 0, y: 0 }, target, 16, 90), target, 16, 90)
    expect(two.x).toBeCloseTo(one.x, 9)
  })
})
