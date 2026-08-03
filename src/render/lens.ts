import type { Point } from '../atlas/hex'

/**
 * Lens disc radius in CSS pixels. Deliberately well under the viewport: the
 * undisturbed field outside it is what makes the atlas read as dense.
 */
export const LENS_RADIUS = 380
/** Peak magnification at the lens centre is K + 1. */
export const LENS_K = 8
export const LENS_TAU_MS = 90
export const BRIGHT_MIN = 0.12
export const BRIGHT_POW = 3

export type Lens = { cx: number; cy: number; radius: number; k: number }

export type TileTransform = {
  x: number
  y: number
  /** Direction from the lens centre, in radians. */
  angle: number
  /** Scale along `angle`. */
  radial: number
  /** Scale across `angle`. */
  tangential: number
  brightness: number
}

export function makeLens(cx: number, cy: number): Lens {
  return { cx, cy, radius: LENS_RADIUS, k: LENS_K }
}

/** Sarkar-Brown radial magnification: f(d). Identity at and beyond the edge. */
export function lensRadius(d: number, lens: Lens): number {
  if (d >= lens.radius) return d
  const u = d / lens.radius
  return (lens.radius * u * (lens.k + 1)) / (u * lens.k + 1)
}

/** f'(d) — how much f stretches space along the radius. */
export function radialScale(d: number, lens: Lens): number {
  if (d >= lens.radius) return 1
  const t = (d / lens.radius) * lens.k + 1
  return (lens.k + 1) / (t * t)
}

/**
 * f(d)/d — how much f stretches space across the radius. Always at least
 * `radialScale`, which is why tiles compress into slivers toward the edge.
 */
export function tangentialScale(d: number, lens: Lens): number {
  if (d >= lens.radius) return 1
  if (d < 1e-9) return lens.k + 1
  return lensRadius(d, lens) / d
}

export function brightness(d: number, lens: Lens): number {
  const u = d >= lens.radius ? 1 : d / lens.radius
  return BRIGHT_MIN + (1 - BRIGHT_MIN) * Math.pow(1 - u, BRIGHT_POW)
}

export function transformTile(p: Point, lens: Lens): TileTransform {
  const dx = p.x - lens.cx
  const dy = p.y - lens.cy
  const d = Math.hypot(dx, dy)

  // At the exact centre the ray is undefined; both scales converge to k+1.
  if (d < 1e-9) {
    return {
      x: lens.cx,
      y: lens.cy,
      angle: 0,
      radial: lens.k + 1,
      tangential: lens.k + 1,
      brightness: brightness(0, lens),
    }
  }

  const f = lensRadius(d, lens)
  return {
    x: lens.cx + (dx / d) * f,
    y: lens.cy + (dy / d) * f,
    angle: Math.atan2(dy, dx),
    radial: radialScale(d, lens),
    tangential: tangentialScale(d, lens),
    brightness: brightness(d, lens),
  }
}

/**
 * Inverse of the forward map, so hit-testing lands on the tile you can see.
 * The denominator bottoms out at 1 when v = 1, so staying inside the radius is
 * the only guard needed to keep clear of its root at v = (k+1)/k.
 */
export function unlensPoint(p: Point, lens: Lens): Point {
  const dx = p.x - lens.cx
  const dy = p.y - lens.cy
  const dPrime = Math.hypot(dx, dy)
  if (dPrime >= lens.radius || dPrime < 1e-9) return { x: p.x, y: p.y }

  const v = dPrime / lens.radius
  const d = (lens.radius * v) / (lens.k + 1 - v * lens.k)
  return { x: lens.cx + (dx / dPrime) * d, y: lens.cy + (dy / dPrime) * d }
}

/** Exponential ease that gives the same result regardless of frame pacing. */
export function easeCentre(
  c: Point,
  target: Point,
  dtMs: number,
  tauMs: number = LENS_TAU_MS,
): Point {
  const a = 1 - Math.exp(-dtMs / tauMs)
  return { x: c.x + (target.x - c.x) * a, y: c.y + (target.y - c.y) * a }
}
