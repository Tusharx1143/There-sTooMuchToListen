# Cursor-Following Lens Distortion — Design

**Supersedes** `2026-08-03-adaptive-hex-sizing-design.md`. That spec sized the hex grid to the viewport so tiles would read clearly on large displays. This one solves the same "the atlas looks tiny" problem the way the reference site does — with density plus a magnifying lens — which makes adaptive sizing unnecessary. Nothing from the superseded spec is implemented.

**Problem:** `HEX_SIZE` is a fixed 34 CSS pixels and hover magnifies one tile to `1.45x`. The result reads as a sparse grid with a highlighted cell, not as a field you explore. The reference (`nothing-to-watch.port80.ch`) gets its effect from the opposite arrangement: a very dense field of tiny tiles, with a cursor-following radial lens that magnifies a small disc and dims everything else.

**Goal:** A dense hex field with a cursor-following fisheye lens — radial displacement, per-tile scale, brightness falloff — while keeping the existing pan, momentum, minimap, search, and audio behaviour intact.

## Decisions taken from the live prototype

The lens was prototyped interactively before this spec was written (`.superpowers/brainstorm/1570-1785779787/content/lens-scale-mode.html`). Two findings changed the design:

1. **Tile scale is anisotropic.** The position map `f(d)` stretches space by `f'(d)` radially but by `f(d)/d` tangentially, and those differ. Sizing tiles by the radial derivative alone (the obvious first choice) under-fills tangentially and produces visible radial gap spokes around the lens. Sizing by the tangential factor closes the gaps but overlaps tiles substantially near the centre. Only the anisotropic form is correct in both directions — and it is what produces the reference's compressed sliver tiles at the lens rim.
2. **`LENS_RADIUS = 380` is confirmed**, well below the viewport dimension. This keeps ~4,300 tiles at undisturbed base size, which is what makes the field read as dense. It places the Sarkar-Brown compression ring on screen at `r = 380`; `BRIGHT_MIN` renders that ring at 12% brightness, where it reads as a vignette. This is intentional, not an artifact to fix.

## Constants

| Constant | Value | Home | Note |
|---|---|---|---|
| `HEX_SIZE` | `12` | `src/atlas/hex.ts` | was `34`; the only density knob |
| `LENS_RADIUS` | `380` | `src/render/lens.ts` | `D`, CSS px |
| `LENS_K` | `8` | `src/render/lens.ts` | peak magnification is `k + 1 = 9x` |
| `LENS_TAU_MS` | `90` | `src/render/lens.ts` | ease time constant |
| `BRIGHT_MIN` | `0.12` | `src/render/lens.ts` | brightness floor outside the lens |
| `BRIGHT_POW` | `3` | `src/render/lens.ts` | falloff shape |
| `ART_MIN_PX` | `32` | `src/render/canvas.ts` | keyed on the *radial* extent |
| `DATA_RADIUS_PX` | `120` | `src/render/canvas.ts` | world-space disc for `store.ensure` |
| `TILE_GAP` | `0.94` | `src/render/canvas.ts` | unchanged |

Derived figures at 1920×1080, used as test budgets below:

- tiles on screen ≈ **5,540**, of which ≈ **1,213** fall inside `D` and need the anisotropic transform
- art-tier tiles ≈ **13**, against `IMAGE_CACHE_CAPACITY = 600`
- cells loaded ≈ **20** (~660KB), against ~12 today
- focal tile `12 × 9 = 108px`; world shrinks from 11,806 × 15,351 to **4,167 × 5,418px**

## Architecture

### New module: `src/render/lens.ts`

Pure, no canvas, no DOM. Every function is total and testable in isolation.

```ts
export type Lens = { cx: number; cy: number; radius: number; k: number }

export type TileTransform = {
  x: number      // displaced screen position
  y: number
  angle: number  // radians, direction from lens centre to tile
  radial: number // scale along `angle`
  tangential: number
  brightness: number
}

export function lensRadius(d: number, lens: Lens): number
export function radialScale(d: number, lens: Lens): number
export function tangentialScale(d: number, lens: Lens): number
export function brightness(d: number, lens: Lens): number
export function transformTile(p: Point, lens: Lens): TileTransform
export function unlensPoint(p: Point, lens: Lens): Point
export function easeCentre(c: Point, target: Point, dtMs: number, tauMs: number): Point
```

With `u = d/D` and `v = d'/D` clamped to `[0, 1]`:

| | `d < D` | `d >= D` |
|---|---|---|
| `lensRadius` | `D·u(k+1)/(uk+1)` | `d` |
| `radialScale` | `(k+1)/(uk+1)²` | `1` |
| `tangentialScale` | `(k+1)/(uk+1)` | `1` |
| `brightness` | `BRIGHT_MIN + (1−BRIGHT_MIN)(1−u)^BRIGHT_POW` | `BRIGHT_MIN` |
| `unlensPoint` radius | `D·v/((k+1) − vk)` | `d'` |

`tangentialScale >= radialScale` everywhere, since `uk + 1 >= 1`. At `d = 0` both converge to `k + 1` and `angle` is arbitrary; `transformTile` returns `angle = 0` there.

The inverse denominator `(k+1) − vk` bottoms out at `1` when `v = 1`, so clamping `v` to `[0,1]` is the only guard the inverse needs. `unlensPoint` is what makes hit-testing exact: screen → world stays correct anywhere in the lens, so clicking a magnified neighbour lands on that neighbour.

Because scale is exact in both directions, tiles tessellate and **no per-frame depth sort is needed**. `TILE_GAP` absorbs the residual first-order error.

### `src/render/tile.ts`

`drawTile` takes the transform instead of a single `scale`:

```ts
export type TileOpts = {
  x: number; y: number
  size: number            // HEX_SIZE * TILE_GAP, pre-transform
  angle: number
  radial: number
  tangential: number
  alpha: number
  image: CanvasImageSource | null
  colors: [string, string]
  highlighted: boolean
  dim: boolean            // now means only: failed song, rendered inert
}
```

It wraps drawing in `save / translate(x,y) / rotate(angle) / scale(radial, tangential) / …/ restore`, with the hex path drawn at the origin. `hexPath` is unchanged.

**Fast path:** when `radial === 1 && tangential === 1` (every tile outside `D` — roughly 4,300 of 5,540) skip the transform entirely and draw at `(x, y)` directly. This is what keeps the frame affordable.

### The cached field layer

Drawing every tile live costs ~18.6ms per frame of canvas work at 1920×1080 — over budget before any application logic runs. The fix rests on an invariant the transform gives us for free: **outside `LENS_RADIUS` both scales are exactly 1 and `brightness` is exactly `BRIGHT_MIN`**, so those tiles are pixel-identical wherever the lens happens to be. They depend only on `view`.

`AtlasRenderer` therefore keeps an offscreen canvas holding the undistorted field, keyed on `view`, canvas size, and `devicePixelRatio`. Each frame it blits that canvas, clips to the lens disc and clears it, then redraws only the ~1,213 warped tiles. Measured: **18.6ms → 2.6ms, a 7.1× reduction.** A full field repaint (pan or resize only) costs 13.6ms — itself cheaper than the old live path, because the cached pass shares one alpha and one scale across every tile and so skips `drawTile`'s per-tile `save`/transform entirely.

The cached layer **deliberately never consults `CellStore`**. `store.ensure()` evicts every cell outside the current lens neighbourhood, so a roaming lens evicts and refetches continuously; letting that traffic invalidate the field repainted it several times a second and cost more than the cache saved. Out there, at 12% alpha, a hashed `speckleColor` hue is indistinguishable from a real album-derived one. This is the invariant the optimisation depends on, and `tests/renderer.test.ts` pins it.

The offscreen context is optional: if `getContext('2d')` returns null (jsdom, and any exotic browser), the renderer falls back to drawing every tile live. The constructor takes an optional canvas factory so tests can inject a counting stub and assert the optimisation directly.

### `src/render/canvas.ts`

`draw()` becomes: `visibleOffsets(rect, layout)` → per tile, world centre → subtract `view` → `transformTile()` → three render tiers keyed on the tile's **radial** (smaller) extent, `size * radial`:

| Tier | Condition | Behaviour |
|---|---|---|
| art | `>= ART_MIN_PX` | `images.get(song.art)`, hex-clipped |
| solid | `>= 8px` | `hexPath` + flat fill, no gradient, **no image request** |
| speck | `< 8px` | bare `fillRect`, no path, no clip |

Keying the art tier on the radial extent rather than the tangential one matters: a tile 40px tangentially and 5px radially is a sliver, not a readable cover. Using the smaller dimension is both more honest about legibility and much cheaper (≈13 requests instead of ≈62).

Per-frame `createLinearGradient` across thousands of tiles is the main cost to avoid — only the art tier may build one, and only when its image has not loaded yet.

Tiles whose cell is not loaded draw `speckleColor(col, row)` (new, in `imageCache.ts`, same hash shape as `fallbackColors`). The field stays dense with no data behind it.

`store.ensure()` switches from the viewport rect to the `DATA_RADIUS_PX` disc around the lens centre in world space. `HOVER_SCALE` is deleted — the focal tile is simply the tile at `d ≈ 0`, magnified by the same curve as everything else, and keeps its white stroke.

`AtlasRenderer` gains:

```ts
lensTarget: Point           // set from input
private lensCentre: Point   // eased each frame
get focal(): Offset | null  // tile under the settled lens centre
```

`hoverAt(clientX, clientY)` becomes `screen → unlensPoint → + view → pixelToAxial(world)`.

The render loop keeps its dirty-flag idle, plus an always-redraw condition while `|lensCentre − lensTarget| > 0.25px`, so easing animates and then settles back to idle.

### Untouched

`src/atlas/layout.ts`, `viewport.ts`, `ui/minimap.ts`, `ui/search.ts`, `ui/axisLabels.ts`, `render/momentum.ts`, `audio/engine.ts`. The minimap and `clampView` read `layout.widthPx`/`heightPx`, which follow `HEX_SIZE` automatically. `centreOf` has no implicit-size bug to fix here, because with a single fixed base size the default is the only size — the problem the superseded spec had to work around does not arise.

## Data flow

**Desktop** (`main.ts`, `attachPointer`): `onHover` sets `renderer.lensTarget` rather than calling `setHover`. The focal offset is recomputed per frame from the eased centre. `onClick` and `onPan` are unchanged except that `hoverAt` now un-lenses first. On `pointerleave` the lens freezes where it is and the focal highlight clears.

**Touch** (`attachTouch`): `lensTarget` is pinned to the viewport centre; panning slides the world beneath a stationary lens. `onTap` still selects via `hoverAt`. No second interaction model.

**Audio:** `AudioEngine.hover()` already debounces internally, so no change there. But the focal tile changes continuously while the lens eases, which would reset that debounce indefinitely. The renderer therefore reports a focal tile to `main.ts` only once the lens has settled (the same `0.25px` threshold as the redraw condition).

## Error handling and edge cases

- **`d = 0`** — `transformTile` returns `angle = 0`, both scales `k + 1`; no division by zero.
- **Inverse out of range** — `unlensPoint` clamps `v` to `[0,1]` before inverting, so a screen point beyond `D` maps through the identity branch rather than past the denominator's root at `v = (k+1)/k`.
- **Pointer leaves the canvas** — lens freezes at its last position; it does not snap to a corner or to the origin.
- **First frame** — `lensCentre` initialises to the viewport centre, not `(0,0)`, so the lens does not fly in from the top-left.
- **Resize** — canvas backing store resizes as today. `LENS_RADIUS` is a fixed constant, not viewport-derived, so nothing else recomputes; `lensCentre` is re-clamped into the new bounds.
- **Cell not loaded** — `speckleColor(col, row)` fills, no request, no song, no art. Expected for most of the field.
- **Song present but art still loading** — falls back to `fallbackColors` gradient exactly as today.

## Testing

`tests/lens.test.ts` (new):

- `lensRadius`: `f(0) = 0`, `f(D) = D`, strictly monotonic on `[0, D]`, identity beyond `D`
- `radialScale`: `k+1` at `0`, `1/(k+1)` at `D`, `1` beyond
- `tangentialScale`: `k+1` at `0`, `1` at `D`; `tangential >= radial` across 100 sampled radii
- `unlensPoint` round-trip: `unlens(lens(p)) ≈ p` for 100 sampled points, inside and outside `D`
- `brightness`: `1` at centre, `BRIGHT_MIN` at and beyond `D`, monotonically decreasing
- `easeCentre`: converges toward the target; dt-stable — two half-steps land within tolerance of one full step
- `transformTile` at `d = 0`: finite, `angle = 0`, no `NaN`

`tests/renderer.test.ts` (extend):

- image requests fire only above `ART_MIN_PX` — with a stub `ImageCache`, assert the call count is ~13, not ~5,540
- `store.ensure` receives the lens-scoped key set, not the viewport key set
- `focal` is reported only after the lens settles
- **Budget assertions** at a stubbed 1920×1080 with default constants: art-tier count `< IMAGE_CACHE_CAPACITY`, and transform-eligible count (`d < D`) `< 1500`. These are the guards that keep the constants honest if someone retunes `LENS_RADIUS` or `ART_MIN_PX` later. They are counts, not wall-clock timings, so they stay deterministic in jsdom.

`tests/hex.test.ts`, `viewport.test.ts`, `layout.test.ts`: unchanged. They parameterise on `size` and never assert `HEX_SIZE`'s value.

**Manual verification:** the lens tracks the cursor with a slight lag and settles; the compression ring at `r = 380` reads as a vignette rather than a seam; panning and momentum still work with the lens active; the minimap viewport rectangle is proportionally correct against the smaller world; a touch device shows a centred lens that the world pans beneath.

## Out of scope

- Album art outside the lens (would need a prebaked sprite atlas or a dominant-colour manifest field — both are harvest-pipeline changes).
- A user-facing zoom or lens-strength control.
- Migrating the renderer to WebGL. Canvas 2D is the bet here; the budget assertions above are what would tell us it was the wrong one.
- Why some tiles show gradient fallbacks instead of real art — a separate data/loading concern.
