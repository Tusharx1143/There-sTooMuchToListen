# Lens Distortion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sparse hex grid and single-tile hover pop with a dense field under a cursor-following fisheye lens — radial displacement, anisotropic per-tile scale, and brightness falloff.

**Architecture:** A new pure module `src/render/lens.ts` owns the Sarkar-Brown radial transform and its analytic inverse. `AtlasRenderer` keeps an eased lens centre, transforms every visible tile through it, and picks one of three render tiers from the tile's radial extent. `drawTile` grows a rotation plus two scale factors. Pan, momentum, minimap, search, and audio are untouched.

**Tech Stack:** TypeScript (strict), Vite, Canvas 2D, Vitest + jsdom, Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-08-03-lens-distortion-design.md`

## Global Constraints

- Node `>=20`. ESM only (`"type": "module"`).
- `npm run build` runs `tsc --noEmit` first — every task must typecheck clean.
- `npm test` runs `vitest run` over `tests/**` excluding `tests/e2e/**`.
- Vitest has `globals: true` and `environment: 'jsdom'`. jsdom reports `window.innerWidth = 1024`, `window.innerHeight = 768`.
- jsdom has **no canvas implementation** — `canvas.getContext('2d')` returns `null`. Every renderer/tile test must inject a fake context. Never call a real canvas API in a unit test.
- `tests/architecture.test.ts` enforces: no `from 'node:*'` imports anywhere in `src/`, and no music-API hostnames in `src/`. New modules satisfy both trivially — do not import Node built-ins into `src/render/lens.ts`.
- Existing tests in `tests/hex.test.ts`, `tests/layout.test.ts`, `tests/viewport.test.ts` reference `HEX_SIZE` symbolically and must keep passing unmodified.
- Comments explain *why*, not *what* — match the density and voice of the surrounding code.

---

### Task 1: Lens math module

**Files:**
- Create: `src/render/lens.ts`
- Test: `tests/lens.test.ts`

**Interfaces:**
- Consumes: `Point` from `src/atlas/hex.ts`.
- Produces: `Lens`, `TileTransform`, `makeLens`, `lensRadius`, `radialScale`, `tangentialScale`, `brightness`, `transformTile`, `unlensPoint`, `easeCentre`, and constants `LENS_RADIUS = 380`, `LENS_K = 8`, `LENS_TAU_MS = 90`, `BRIGHT_MIN = 0.12`, `BRIGHT_POW = 3`.

- [ ] **Step 1: Write the failing test**

Create `tests/lens.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lens.test.ts`
Expected: FAIL — `Failed to resolve import "../src/render/lens"`.

- [ ] **Step 3: Write the implementation**

Create `src/render/lens.ts`:

```ts
import type { Point } from '../atlas/hex'

/** Lens disc radius in CSS pixels. Deliberately well under the viewport: the
 *  undisturbed field outside it is what makes the atlas read as dense. */
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
      x: lens.cx, y: lens.cy, angle: 0,
      radial: lens.k + 1, tangential: lens.k + 1,
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
 * The denominator bottoms out at 1 when v = 1, so clamping v is the only
 * guard needed to stay clear of its root at v = (k+1)/k.
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lens.test.ts`
Expected: PASS, all suites green.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (success).

- [ ] **Step 6: Commit**

```bash
git add src/render/lens.ts tests/lens.test.ts
git commit -m "feat: add lens transform module with analytic inverse"
```

---

### Task 2: Flip the grid to dense

**Files:**
- Modify: `src/atlas/hex.ts:6`

**Interfaces:**
- Consumes: nothing.
- Produces: `HEX_SIZE` is now `12`. Every consumer (`layout.widthPx`/`heightPx`, `viewport`, `canvas`) follows automatically.

- [ ] **Step 1: Confirm no test hardcodes the old value**

Run: `grep -rn "HEX_SIZE" tests/`
Expected: only symbolic references in `tests/hex.test.ts` and `tests/viewport.test.ts` — no literal `34` anywhere.

- [ ] **Step 2: Change the constant**

In `src/atlas/hex.ts`, replace lines 5-6:

```ts
/** Distance from a hex centre to a corner, in CSS pixels. */
export const HEX_SIZE = 34
```

with:

```ts
/**
 * Distance from a hex centre to a corner, in CSS pixels. Small on purpose —
 * legibility comes from the lens (src/render/lens.ts), not from tile size, and
 * a dense field is the whole point.
 */
export const HEX_SIZE = 12
```

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: PASS. The atlas world shrinks from 11,806 × 15,351 to 4,167 × 5,418 px; `layout`, `viewport`, and `minimap` derive from `HEX_SIZE` so nothing needs updating.

- [ ] **Step 4: Commit**

```bash
git add src/atlas/hex.ts
git commit -m "feat: shrink HEX_SIZE to 12 for a dense field"
```

---

### Task 3: Speckle colour and render tiers

**Files:**
- Modify: `src/render/imageCache.ts` (append `speckleColor`)
- Modify: `src/render/tile.ts` (prepend tier constants and `tileTier`)
- Test: `tests/tile.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `speckleColor(col: number, row: number): string` from `imageCache.ts`; `ART_MIN_PX = 32`, `SOLID_MIN_PX = 8`, `TILE_GAP = 0.94`, `type TileTier = 'art' | 'solid' | 'speck'`, and `tileTier(radialPx: number): TileTier` from `tile.ts`. Task 5 and Task 7 both import `tileTier` and `TILE_GAP`.

Note: `TILE_GAP` currently lives in `src/render/canvas.ts:10` as a module-private constant. This task moves it to `tile.ts` and exports it, because the budget test in Task 5 needs it and it belongs with the tile geometry.

- [ ] **Step 1: Write the failing test**

Create `tests/tile.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { tileTier, ART_MIN_PX, SOLID_MIN_PX, TILE_GAP } from '../src/render/tile'
import { speckleColor } from '../src/render/imageCache'

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

  it('does not collide between transposed coordinates', () => {
    expect(speckleColor(2, 11)).not.toBe(speckleColor(11, 2))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tile.test.ts`
Expected: FAIL — `tileTier is not a function` / `speckleColor is not exported`.

- [ ] **Step 3: Add `speckleColor`**

Append to `src/render/imageCache.ts`:

```ts
/**
 * Colour for a hex with no song behind it. Most of the field is unloaded by
 * design — only the lens neighbourhood fetches cells — so the speckle is what
 * keeps the grid looking dense for free.
 */
export function speckleColor(col: number, row: number): string {
  const s = `${col}:${row}`
  let hash = 0
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0
  return `hsl(${Math.abs(hash) % 360}, 38%, 22%)`
}
```

- [ ] **Step 4: Add the tier helper**

At the top of `src/render/tile.ts`, above `TileOpts`:

```ts
/** Below this radial extent a tile is too small to be worth an image request. */
export const ART_MIN_PX = 32
/** Below this, skip the hex path entirely and draw a bare rect. */
export const SOLID_MIN_PX = 8
export const TILE_GAP = 0.94

export type TileTier = 'art' | 'solid' | 'speck'

/**
 * Keyed on the tile's radial (smaller) extent, not the tangential one: under
 * the lens a rim tile can be 40px across and 5px deep, and a sliver is not a
 * readable cover.
 */
export function tileTier(radialPx: number): TileTier {
  if (radialPx >= ART_MIN_PX) return 'art'
  if (radialPx >= SOLID_MIN_PX) return 'solid'
  return 'speck'
}
```

- [ ] **Step 5: Remove the old TILE_GAP**

In `src/render/canvas.ts`, delete line 10 (`const TILE_GAP = 0.94`). Leave the rest of the file alone for now — it still imports `HEX_SIZE` and compiles, because Task 7 rewrites it. Add `TILE_GAP` to the existing `./tile` import on line 6:

```ts
import { drawTile, TILE_GAP } from './tile'
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run tests/tile.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/render/tile.ts src/render/imageCache.ts src/render/canvas.ts tests/tile.test.ts
git commit -m "feat: add render tiers and speckle colour"
```

---

### Task 4: Anisotropic drawTile

**Files:**
- Modify: `src/render/tile.ts` (`TileOpts`, `drawTile`)
- Test: `tests/tile.test.ts` (extend)

**Interfaces:**
- Consumes: `tileTier`, `hexPath` from this file.
- Produces: the new `TileOpts` shape below. Task 7 constructs it per tile.

```ts
export type TileOpts = {
  x: number; y: number
  size: number          // HEX_SIZE * TILE_GAP, pre-transform
  angle: number
  radial: number
  tangential: number
  alpha: number
  image: CanvasImageSource | null
  colors: [string, string]
  highlighted: boolean
  dim: boolean
}
```

- [ ] **Step 1: Write the failing test**

Append to `tests/tile.test.ts`:

```ts
import { drawTile, hexPath, type TileOpts } from '../src/render/tile'

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
    drawTile(ctx, opts({ size: 2, radial: 1, tangential: 1 }))
    expect(calls).toContain('fillRect')
    expect(calls).not.toContain('clip')
    expect(calls).not.toContain('createLinearGradient')
    expect(calls).not.toContain('drawImage')
  })

  it('draws solid tiles as filled hexes with no gradient', () => {
    const { ctx, calls } = fakeCtx()
    drawTile(ctx, opts({ size: 12, radial: 1, tangential: 1 }))
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
    // globalAlpha is set inside the save/restore pair; assert it was assigned.
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tile.test.ts`
Expected: FAIL — the new `TileOpts` fields do not exist; type errors on `angle`/`radial`/`tangential`/`alpha`.

- [ ] **Step 3: Rewrite drawTile**

Replace `TileOpts` and `drawTile` in `src/render/tile.ts` (keep `hexPath` exactly as it is):

```ts
export type TileOpts = {
  x: number
  y: number
  /** Pre-transform hex radius: HEX_SIZE * TILE_GAP. */
  size: number
  angle: number
  radial: number
  tangential: number
  alpha: number
  image: CanvasImageSource | null
  colors: [string, string]
  highlighted: boolean
  /** Failed preview — rendered visibly inert. */
  dim: boolean
}

export function drawTile(ctx: CanvasRenderingContext2D, o: TileOpts): void {
  const tier = tileTier(o.size * o.radial)
  const s = o.size

  ctx.save()
  ctx.globalAlpha = o.alpha
  ctx.translate(o.x, o.y)

  // Everything outside the lens comes through at scale 1; skipping the
  // transform there is what keeps ~4,300 of ~5,500 tiles cheap.
  const warped = o.radial !== 1 || o.tangential !== 1
  if (warped) {
    ctx.rotate(o.angle)
    ctx.scale(o.radial, o.tangential)
  }

  if (tier === 'speck') {
    ctx.fillStyle = o.colors[0]
    ctx.fillRect(-s, -s, s * 2, s * 2)
    ctx.restore()
    return
  }

  if (tier === 'solid') {
    hexPath(ctx, 0, 0, s)
    ctx.fillStyle = o.colors[0]
    ctx.fill()
    ctx.restore()
    return
  }

  ctx.save()
  hexPath(ctx, 0, 0, s)
  ctx.clip()

  if (o.image) {
    // Album art is square; cover the hex's bounding box.
    const d = s * 2
    ctx.drawImage(o.image, -d / 2, -d / 2, d, d)
  } else {
    const g = ctx.createLinearGradient(-s, -s, s, s)
    g.addColorStop(0, o.colors[0])
    g.addColorStop(1, o.colors[1])
    ctx.fillStyle = g
    ctx.fillRect(-s, -s, s * 2, s * 2)
  }

  if (o.dim) {
    ctx.fillStyle = 'rgba(7, 7, 12, 0.45)'
    ctx.fillRect(-s, -s, s * 2, s * 2)
  }

  ctx.restore()

  if (o.highlighted) {
    hexPath(ctx, 0, 0, s)
    ctx.strokeStyle = '#ffffff'
    // Undo the tile's own scaling so the outline keeps a constant screen width.
    ctx.lineWidth = 2 / Math.max(o.radial, o.tangential)
    ctx.stroke()
  }

  ctx.restore()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Note `npx tsc --noEmit` will still fail here because `canvas.ts` passes the old `TileOpts` shape — Task 7 fixes that. Commit the tile work on its own so the change stays reviewable:

```bash
git add src/render/tile.ts tests/tile.test.ts
git commit -m "feat: make drawTile anisotropic"
```

---

### Task 5: Constant budget guards

**Files:**
- Test: `tests/lensBudget.test.ts` (create)

**Interfaces:**
- Consumes: `HEX_SIZE`, `axialToPixel`, `offsetToAxial` from `atlas/hex`; `makeLens`, `transformTile` from `render/lens`; `tileTier`, `TILE_GAP` from `render/tile`; `IMAGE_CACHE_CAPACITY` from `render/imageCache`.
- Produces: nothing — this task adds no production code. It is the guard that keeps the constants honest if anyone retunes them later.

- [ ] **Step 1: Write the test**

Create `tests/lensBudget.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { HEX_SIZE, axialToPixel, offsetToAxial } from '../src/atlas/hex'
import { makeLens, transformTile } from '../src/render/lens'
import { tileTier, TILE_GAP } from '../src/render/tile'
import { IMAGE_CACHE_CAPACITY } from '../src/render/imageCache'

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

  it('fills the screen densely', () => {
    expect(s.total).toBeGreaterThan(4000)
    expect(s.total).toBeLessThan(7000)
  })

  it('keeps image requests inside the cache', () => {
    expect(s.art).toBeGreaterThan(0)
    expect(s.art).toBeLessThan(IMAGE_CACHE_CAPACITY)
  })

  it('keeps the transformed tile count affordable', () => {
    expect(s.warped).toBeGreaterThan(0)
    expect(s.warped).toBeLessThan(1500)
  })
})
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/lensBudget.test.ts`
Expected: PASS. For reference, the spec's defaults produce roughly `total ≈ 5,540`, `warped ≈ 1,213`, `art ≈ 12`.

- [ ] **Step 3: Prove the guard bites**

Temporarily edit `src/render/tile.ts` and set `ART_MIN_PX = 4`. Run `npx vitest run tests/lensBudget.test.ts`.
Expected: FAIL on "keeps image requests inside the cache". **Revert `ART_MIN_PX` back to `32`** and re-run to confirm PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/lensBudget.test.ts
git commit -m "test: guard the lens constant budgets"
```

---

### Task 6: Renderer lens state

**Files:**
- Modify: `src/render/canvas.ts` (state, `hoverAt`, `resize`, `step`, `start`)
- Test: `tests/renderer.test.ts` (extend)

**Interfaces:**
- Consumes: `makeLens`, `transformTile`, `unlensPoint`, `easeCentre` from `render/lens`.
- Produces: on `AtlasRenderer` — `lensTarget: Point` (public, settable), `get lensCentre(): Point`, `get settled(): boolean`, `get focal(): Offset | null`, `step(dtMs: number): void`, `onFocalChange(cb: (o: Offset | null) => void): () => void`. **Removes** `setHover()` and `get hovered()`. Task 8 rewires `main.ts` onto the new surface.

- [ ] **Step 1: Write the failing test**

Append to `tests/renderer.test.ts`:

```ts
import { AtlasRenderer } from '../src/render/canvas'
import { ImageCache } from '../src/render/imageCache'
import { axialToPixel, offsetToAxial } from '../src/atlas/hex'
import { makeLens, transformTile } from '../src/render/lens'

function stubCanvas(): HTMLCanvasElement {
  const ctx = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'createLinearGradient') return () => ({ addColorStop: () => {} })
      return () => {}
    },
    set: () => true,
  })
  return {
    width: 0, height: 0, style: {},
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement
}

function stubImages(): ImageCache {
  return new ImageCache({
    make: () => ({
      crossOrigin: '', src: '', decode: async () => {},
    } as unknown as HTMLImageElement),
  })
}

function makeRenderer(): AtlasRenderer {
  const l = new AtlasLayout(['us', 'br'], [14, 21])
  const fetcher = (async () => ({ ok: true, status: 200, json: async () => [] })) as unknown as typeof fetch
  return new AtlasRenderer(stubCanvas(), l, new CellStore({ fetcher }), stubImages())
}

describe('AtlasRenderer lens', () => {
  it('starts with the lens on the viewport centre', () => {
    const r = makeRenderer()
    expect(r.lensTarget).toEqual({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    expect(r.lensCentre).toEqual(r.lensTarget)
    expect(r.settled).toBe(true)
  })

  it('eases toward a new target and reports unsettled on the way', () => {
    const r = makeRenderer()
    r.lensTarget = { x: 50, y: 60 }
    expect(r.settled).toBe(false)
    r.step(16)
    expect(r.lensCentre.x).toBeGreaterThan(50)
    expect(r.lensCentre.x).toBeLessThan(window.innerWidth / 2)
    r.step(5000)
    expect(r.settled).toBe(true)
    expect(r.lensCentre).toEqual({ x: 50, y: 60 })
  })

  it('hit-tests back to the tile that was drawn at that screen point', () => {
    const r = makeRenderer()
    // Park the lens near the top-left so these tiles fall inside the disc.
    r.lensTarget = { x: 60, y: 70 }
    r.step(5000)

    const lens = makeLens(r.lensCentre.x, r.lensCentre.y)
    for (const [col, row] of [[3, 4], [5, 8], [7, 12]]) {
      const t = transformTile(axialToPixel(offsetToAxial({ col, row })), lens)
      expect(r.hoverAt(t.x, t.y)).toEqual({ col, row })
    }
  })

  it('returns null outside the atlas', () => {
    const r = makeRenderer()
    expect(r.hoverAt(-500, -500)).toBeNull()
  })

  it('notifies focal changes only once settled', () => {
    const r = makeRenderer()
    const seen: (Offset | null)[] = []
    r.onFocalChange((o) => seen.push(o))

    r.lensTarget = { x: 60, y: 70 }
    r.step(16)
    expect(seen).toHaveLength(0)

    r.step(5000)
    expect(seen.length).toBeGreaterThan(0)
    expect(r.focal).not.toBeNull()
  })
})
```

Add `Offset` to the type import at the top of the file:

```ts
import type { Song, Offset } from '../src/types'
```

Note: `Offset` is exported from `src/atlas/hex.ts`, not `src/types.ts`. Use:

```ts
import type { Offset } from '../src/atlas/hex'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer.test.ts`
Expected: FAIL — `r.lensTarget is undefined` / `r.step is not a function`.

- [ ] **Step 3: Add lens state to AtlasRenderer**

In `src/render/canvas.ts`, update the imports:

```ts
import { axialToPixel, offsetToAxial, pixelToAxial, axialToOffset, HEX_SIZE, type Offset, type Point } from '../atlas/hex'
import { AtlasLayout } from '../atlas/layout'
import { clampView, requiredCellKeys, visibleOffsets } from '../atlas/viewport'
import type { CellStore } from '../data/loader'
import { ImageCache, fallbackColors, speckleColor } from './imageCache'
import { drawTile, tileTier, TILE_GAP } from './tile'
import { easeCentre, makeLens, transformTile, unlensPoint, type Lens } from './lens'
import { cellKey, type Song } from '../types'

/** World-space radius around the lens whose cells we actually fetch. */
const DATA_RADIUS_PX = 120
/** Under this much distance left to travel, the lens counts as parked. */
const SETTLE_PX = 0.25
```

Delete the `HOVER_SCALE` constant. Replace the `hover` field and its accessors:

```ts
  /** Where the lens is heading. Pointer sets this; touch pins it to centre. */
  lensTarget: Point = { x: 0, y: 0 }

  private centre: Point = { x: 0, y: 0 }
  private focalOffset: Offset | null = null
  private lastFrame = 0
  private readonly focalListeners = new Set<(o: Offset | null) => void>()
```

At the end of the constructor, after `this.resize()`:

```ts
    this.lensTarget = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    this.centre = { ...this.lensTarget }
```

Replace `get hovered()` and `setHover()` with:

```ts
  get lensCentre(): Point {
    return this.centre
  }

  get settled(): boolean {
    return Math.hypot(this.lensTarget.x - this.centre.x, this.lensTarget.y - this.centre.y) <= SETTLE_PX
  }

  get focal(): Offset | null {
    return this.focalOffset
  }

  onFocalChange(cb: (o: Offset | null) => void): () => void {
    this.focalListeners.add(cb)
    return () => this.focalListeners.delete(cb)
  }

  private get lens(): Lens {
    return makeLens(this.centre.x, this.centre.y)
  }

  /** Advances the eased lens. Called by the frame loop; tests drive it directly. */
  step(dtMs: number): void {
    if (this.settled) {
      if (this.centre.x !== this.lensTarget.x || this.centre.y !== this.lensTarget.y) {
        this.centre = { ...this.lensTarget }
        this.invalidate()
      }
      this.updateFocal()
      return
    }
    this.centre = easeCentre(this.centre, this.lensTarget, dtMs)
    this.invalidate()
  }

  /**
   * The focal tile is whatever sits under the lens centre — f(0) = 0, so the
   * centre maps to itself. Only published once the lens has parked, or the
   * audio engine's hover debounce would reset on every eased frame.
   */
  private updateFocal(): void {
    const world = { x: this.centre.x + this.view.x, y: this.centre.y + this.view.y }
    const o = axialToOffset(pixelToAxial(world))
    const next = this.layout.slotAt(o) ? o : null

    if (next?.col === this.focalOffset?.col && next?.row === this.focalOffset?.row) return
    this.focalOffset = next
    for (const cb of this.focalListeners) cb(next)
  }
```

Replace `hoverAt`:

```ts
  /** Screen coordinates → the hex drawn under them, undoing the distortion. */
  hoverAt(clientX: number, clientY: number): Offset | null {
    const flat = unlensPoint({ x: clientX, y: clientY }, this.lens)
    const world = { x: flat.x + this.view.x, y: flat.y + this.view.y }
    const o = axialToOffset(pixelToAxial(world))
    return this.layout.slotAt(o) ? o : null
  }
```

Replace `start()`:

```ts
  start(): void {
    const loop = (ts: number): void => {
      const dt = this.lastFrame ? Math.min(ts - this.lastFrame, 100) : 16
      this.lastFrame = ts
      this.step(dt)

      if (this.dirty) {
        this.dirty = false
        this.draw()
      }
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }
```

Extend `resize()` — before `this.invalidate()`:

```ts
    const clamp = (p: Point): Point => ({
      x: Math.min(Math.max(p.x, 0), window.innerWidth),
      y: Math.min(Math.max(p.y, 0), window.innerHeight),
    })
    this.lensTarget = clamp(this.lensTarget)
    this.centre = clamp(this.centre)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/renderer.test.ts`
Expected: PASS. `draw()` still references the old `TileOpts` shape and `HOVER_SCALE` is gone — if `draw()` fails to compile, comment out its body temporarily and restore it in Task 7. Prefer to go straight on to Task 7 in the same sitting.

- [ ] **Step 5: Commit**

```bash
git add src/render/canvas.ts tests/renderer.test.ts
git commit -m "feat: give AtlasRenderer an eased lens centre"
```

---

### Task 7: Draw through the lens

**Files:**
- Modify: `src/render/canvas.ts` (`draw`)
- Test: `tests/renderer.test.ts` (extend)

**Interfaces:**
- Consumes: everything from Tasks 1, 3, 4, 6.
- Produces: no new public surface. `draw()` now renders the transformed field.

- [ ] **Step 1: Write the failing test**

Append to `tests/renderer.test.ts`:

```ts
describe('AtlasRenderer.draw', () => {
  it('requests art for only a handful of tiles, not the whole field', () => {
    const requested: string[] = []
    const images = {
      get: (url: string) => { requested.push(url); return null },
      onLoad: () => () => {},
    } as unknown as ImageCache

    const l = new AtlasLayout(['us', 'br'], [14, 21])
    const fetcher = (async () => ({ ok: true, status: 200, json: async () => songs(50) })) as unknown as typeof fetch
    const r = new AtlasRenderer(stubCanvas(), l, new CellStore({ fetcher }), images)

    r.lensTarget = { x: 100, y: 100 }
    r.step(5000)
    r.redraw()

    expect(requested.length).toBeLessThan(60)
  })

  it('loads only the cells near the lens, not the whole viewport', () => {
    const asked: string[][] = []
    const l = new AtlasLayout(['us', 'br'], [14, 21])
    const fetcher = (async () => ({ ok: true, status: 200, json: async () => [] })) as unknown as typeof fetch
    const store = new CellStore({ fetcher })
    const original = store.ensure.bind(store)
    store.ensure = (keys: string[]) => { asked.push(keys); original(keys) }

    const r = new AtlasRenderer(stubCanvas(), l, store, stubImages())
    r.redraw()

    expect(asked.length).toBeGreaterThan(0)
    expect(asked[0]!.length).toBeLessThan(l.countries.length * l.genres.length)
  })
})
```

This needs a public way to force one frame. Add `redraw()` to `AtlasRenderer` in Step 3.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer.test.ts`
Expected: FAIL — `r.redraw is not a function`.

- [ ] **Step 3: Rewrite draw()**

Replace the whole `private draw()` method in `src/render/canvas.ts`:

```ts
  /** Forces a synchronous frame. The rAF loop uses this; so do tests. */
  redraw(): void {
    this.draw()
  }

  private draw(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    const lens = this.lens

    // Only the lens neighbourhood gets real data. The rest of the field is
    // speckle — nobody can read a 3px tile, so fetching it would be waste.
    const focusWorld = { x: lens.cx + this.view.x, y: lens.cy + this.view.y }
    this.store.ensure(
      requiredCellKeys(
        {
          x: focusWorld.x - DATA_RADIUS_PX,
          y: focusWorld.y - DATA_RADIUS_PX,
          w: DATA_RADIUS_PX * 2,
          h: DATA_RADIUS_PX * 2,
        },
        this.layout,
      ),
    )

    this.ctx.fillStyle = '#07070c'
    this.ctx.fillRect(0, 0, w, h)

    // f(d) >= d everywhere, so any tile that lands on screen came from inside
    // the untransformed view rect — scanning it is a safe over-estimate.
    const range = visibleOffsets({ x: this.view.x, y: this.view.y, w, h }, this.layout)
    const size = HEX_SIZE * TILE_GAP
    const focal = axialToOffset(pixelToAxial(focusWorld))

    for (let row = range.rowMin; row <= range.rowMax; row++) {
      for (let col = range.colMin; col <= range.colMax; col++) {
        const p = axialToPixel(offsetToAxial({ col, row }))
        const t = transformTile({ x: p.x - this.view.x, y: p.y - this.view.y }, lens)

        const reach = size * Math.max(t.radial, t.tangential)
        if (t.x < -reach || t.x > w + reach || t.y < -reach || t.y > h + reach) continue

        const tier = tileTier(size * t.radial)
        const song = songAt({ col, row }, this.layout, this.store)

        drawTile(this.ctx, {
          x: t.x,
          y: t.y,
          size,
          angle: t.angle,
          radial: t.radial,
          tangential: t.tangential,
          alpha: t.brightness,
          // Only the art tier may touch the cache — get() starts a fetch.
          image: tier === 'art' && song ? this.images.get(song.art) : null,
          colors: song ? fallbackColors(song.id) : [speckleColor(col, row), '#0b0b12'],
          highlighted: col === focal.col && row === focal.row,
          dim: song !== null && this.failedSongs.has(song.id),
        })
      }
    }
  }
```

Note there is no second pass for the focal tile any more: scale is exact in both directions, so tiles tessellate and nothing overlaps.

- [ ] **Step 4: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, no type errors. `cellKey` may now be unused in `canvas.ts` — if `tsc` flags it, remove it from the import.

- [ ] **Step 5: Commit**

```bash
git add src/render/canvas.ts tests/renderer.test.ts
git commit -m "feat: render the atlas through the lens transform"
```

---

### Task 8: Wire up input

**Files:**
- Modify: `src/main.ts:68-127`
- Test: `tests/renderer.test.ts` already covers the renderer surface; no new unit test — this task is verified by `npm run build` plus the e2e smoke test.

**Interfaces:**
- Consumes: `lensTarget`, `focal`, `onFocalChange`, `hoverAt` from Task 6.
- Produces: nothing.

- [ ] **Step 1: Route focal changes to the HUD and audio**

In `src/main.ts`, immediately after `renderer.failedSongs = audio.failed` (line 62), add:

```ts
  // The lens picks the focal tile; the HUD and audio follow it rather than
  // raw pointer position, so they only fire once it has parked.
  renderer.onFocalChange((hex) => {
    hud.update(hex)
    audio.hover(hex ? songAt(hex, layout, store) : null)
  })
```

- [ ] **Step 2: Replace the desktop hover handler**

In the `attachPointer` call, replace the `onHover` and `onLeave` handlers:

```ts
      onHover: (x, y) => {
        renderer.lensTarget = { x, y }
      },
```

```ts
      onLeave: () => {
        // Leave the lens parked where it is rather than snapping it away.
        audio.hover(null)
      },
```

`onPan` and `onClick` stay exactly as they are — `hoverAt` now un-lenses internally, so clicking a magnified tile still resolves correctly.

- [ ] **Step 3: Pin the lens for touch**

Replace the `playAt` helper (lines 68-76) with:

```ts
  const playAt = (x: number, y: number): void => {
    const hex = renderer.hoverAt(x, y)
    const song = hex ? songAt(hex, layout, store) : null
    hud.update(hex)
    if (!song) return
    audio.pin(song)
    card.show(song)
  }
```

and inside the `if (isTouchDevice())` branch, before `attachTouch(...)`, add:

```ts
    // No cursor to follow: park the lens mid-screen and let panning move the
    // world beneath it.
    const pinLens = (): void => {
      renderer.lensTarget = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    }
    pinLens()
    window.addEventListener('resize', pinLens)
```

- [ ] **Step 4: Typecheck and build**

Run: `npm run build`
Expected: PASS — `tsc --noEmit` clean, Vite build succeeds. If `tsc` reports `renderer.setHover` or `renderer.hovered` still referenced, remove those call sites; they no longer exist.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat: drive the lens from pointer and pin it for touch"
```

---

### Task 9: Verify end to end

**Files:**
- No production changes expected.

**Interfaces:**
- Consumes: everything.
- Produces: nothing.

- [ ] **Step 1: Full unit suite**

Run: `npm test`
Expected: PASS, no skipped suites.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: E2E smoke**

Run: `npm run test:e2e`
Expected: PASS. If `tests/e2e/smoke.spec.ts` asserts on hover behaviour that no longer exists, update the assertion to drive `mousemove` and check the focal HUD instead — do not delete the test.

- [ ] **Step 4: Manual check**

Run: `npm run dev`, open the served URL, and confirm each of these:

- the field is dense — thousands of small tiles, not a sparse grid
- moving the cursor drags a magnified disc that lags slightly and then settles
- the compression ring at roughly 380px from the cursor reads as a dark vignette, not a hard seam
- album art appears only in the bright core; the surround is flat speckle
- dragging still pans, and momentum still glides after release
- the minimap rectangle is proportionally correct against the smaller world
- clicking a magnified tile off-centre pins *that* tile, not the centre one
- audio preview starts shortly after the lens parks, and does not machine-gun while moving

- [ ] **Step 5: Commit any fixes and stop the brainstorm server**

```bash
scripts/stop-server.sh "D:/Projects/Listen to anything/.superpowers/brainstorm/1570-1785779787"
```

(The script lives under the superpowers brainstorming skill directory. Prototype files persist regardless; `.superpowers/` is already gitignored.)

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Constants table | 1 (lens), 2 (`HEX_SIZE`), 3 (`ART_MIN_PX`, `TILE_GAP`), 7 (`DATA_RADIUS_PX`) |
| `src/render/lens.ts` module | 1 |
| Forward/inverse/scale/brightness table | 1 |
| `drawTile` anisotropic + fast path | 4 |
| Three render tiers | 3 (`tileTier`), 4 (dispatch), 7 (art gating) |
| `speckleColor` | 3 |
| Lens-scoped `store.ensure` | 7 |
| `HOVER_SCALE` deleted | 6 |
| `lensTarget` / `lensCentre` / `focal` / settle | 6 |
| Un-lensed `hoverAt` | 6 |
| Redraw while easing, idle when settled | 6 |
| Desktop + touch wiring, `pointerleave` freeze | 8 |
| Audio settle gate | 6 (publish gate), 8 (subscription) |
| Edge cases: `d = 0`, inverse clamp, first frame, resize clamp | 1, 6 |
| Budget tests | 5 |
| Untouched modules stay untouched | verified in 2 and 9 |

**Placeholder scan:** none — every code step carries the actual code.

**Type consistency:** `TileOpts` is defined once in Task 4 and constructed once in Task 7 with matching field names. `tileTier`/`TILE_GAP` are exported in Task 3 and consumed in Tasks 4, 5, 7. `transformTile` returns `TileTransform` in Task 1 and is destructured as `t.x/t.y/t.angle/t.radial/t.tangential/t.brightness` in Tasks 5, 6, 7. `step`/`redraw`/`focal`/`onFocalChange`/`lensCentre` are defined in Task 6 and used in Tasks 7 and 8.

**Known ordering wrinkle:** `npx tsc --noEmit` does not pass between Task 4 and Task 7, because `canvas.ts` still builds the old `TileOpts`. Tasks 4, 6 and 7 should land in one sitting. Each still commits separately so the diff stays reviewable.
