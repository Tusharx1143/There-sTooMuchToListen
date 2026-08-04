import type { Point } from '../atlas/hex'

/**
 * Lens disc radius in CSS pixels. Deliberately well under the viewport: the
 * undisturbed field outside it is what makes the atlas read as dense.
 */
export const LENS_RADIUS = 380
/**
 * Peak magnification at the lens centre is K + 1. Modest, because the tiles it
 * magnifies are already album-cover sized: at the old K the focal tile grew
 * wider than the disc containing it.
 */
export const LENS_K = 2
export const LENS_TAU_MS = 90
/**
 * How much of the magnification is given up at full travel speed. The field
 * churns badly when a strong lens is dragged across it; easing k down while
 * moving and back up on arrival keeps the motion legible.
 */
export const LENS_SPEED_SOFTEN = 0.65
/** Time constant for the smoothed speed estimate that drives the softening. */
export const SPEED_TAU_MS = 120
/**
 * Brightness of the undistorted field. High enough to read the covers out
 * there — the lens marks focus, it is not the only lit part of the atlas.
 */
export const BRIGHT_MIN = 0.7
export const BRIGHT_POW = 2

export type Lens = {
  cx: number
  cy: number
  radius: number
  k: number
  /** Brightness floor of the undistorted field, from user settings. */
  brightMin: number
}

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

export function makeLens(
  cx: number,
  cy: number,
  k: number = LENS_K,
  brightMin: number = BRIGHT_MIN,
): Lens {
  return { cx, cy, radius: LENS_RADIUS, k, brightMin }
}

/**
 * Magnification actually applied, given how fast the lens is travelling.
 * `speedScale` is 0 parked and 1 at the speed ceiling. k only ever decreases
 * here, which keeps the rim clear of ART_MIN_PX for free.
 */
export function softenK(k: number, speedScale: number): number {
  const t = Math.min(1, Math.max(0, speedScale))
  return k * (1 - LENS_SPEED_SOFTEN * t)
}

/** Frame-rate independent exponential smoothing for the speed estimate. */
export function easeScalar(current: number, target: number, dtMs: number, tauMs = SPEED_TAU_MS): number {
  const a = 1 - Math.exp(-dtMs / tauMs)
  return current + (target - current) * a
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
  return lens.brightMin + (1 - lens.brightMin) * Math.pow(1 - u, BRIGHT_POW)
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

/**
 * Ceiling on how fast the lens may travel, in CSS pixels per millisecond.
 * Without it the exponential ease covers ~16% of the remaining gap on the
 * first frame, so flicking across a wide screen throws the lens a couple of
 * hundred pixels in one step and it reads as a snap rather than a move.
 */
export const LENS_MAX_SPEED_PX_PER_MS = 2.2
/** The same ceiling while a song is pinned — calmer, so reaching for the
 *  now-playing card does not drag the atlas along behind the cursor. */
export const LENS_MAX_SPEED_PINNED = 0.9
/** Ease time constant while pinned. */
export const LENS_TAU_PINNED_MS = 170

/**
 * Exponential ease that gives the same result regardless of frame pacing,
 * with the per-step travel clamped. The clamp scales with `dtMs`, so unlike a
 * fixed per-frame cap it behaves identically at 60Hz and 144Hz.
 */
export function easeCentre(
  c: Point,
  target: Point,
  dtMs: number,
  tauMs: number = LENS_TAU_MS,
  maxPxPerMs: number = LENS_MAX_SPEED_PX_PER_MS,
): Point {
  const a = 1 - Math.exp(-dtMs / tauMs)
  let dx = (target.x - c.x) * a
  let dy = (target.y - c.y) * a

  const step = Math.hypot(dx, dy)
  const cap = maxPxPerMs * dtMs
  if (step > cap && step > 1e-9) {
    const ratio = cap / step
    dx *= ratio
    dy *= ratio
  }

  return { x: c.x + dx, y: c.y + dy }
}
