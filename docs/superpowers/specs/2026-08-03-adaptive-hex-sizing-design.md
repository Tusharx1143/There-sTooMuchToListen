# Adaptive Hex Sizing — Design

> **Superseded by `2026-08-03-lens-distortion-design.md`. Not implemented.**
> That spec solves the same "the atlas looks tiny" problem with density plus a
> cursor-following lens, which makes viewport-derived hex sizing unnecessary —
> the base size becomes a fixed constant. Kept for the record.

**Problem:** `HEX_SIZE` (`src/atlas/hex.ts:6`) is a fixed 34 CSS-pixel constant, independent of screen size. On a large or high-resolution display the whole atlas renders correctly but looks tiny relative to the window, and the hover pop-out (`HOVER_SCALE = 1.45`, `src/render/canvas.ts:9`) doesn't stand out enough against neighboring tiles. This was confirmed live: on a 7680×3644 virtual display, the entire 1,200-cell atlas rendered into what looked like a small corner of the screen.

**Goal:** Make the hex grid size itself to the viewport so it reads clearly on any screen, and make the hover state pop more. No spotlight/dimming redesign, no manual zoom control, no changes to album-art loading — those are explicitly out of scope for this round.

## Architecture

A new pure module, `src/atlas/scale.ts`, computes hex size from viewport dimensions:

```ts
export const MIN_HEX_SIZE = 40
export const MAX_HEX_SIZE = 90
export const TARGET_VISIBLE_COLUMNS = 20

export function computeHexSize(viewportWidth: number, viewportHeight: number): number
```

`computeHexSize` derives size from `viewportWidth` using the same column-spacing formula the atlas already uses (`sqrt(3) * size` per column, from `src/atlas/hex.ts`'s `axialToPixel`): `size = viewportWidth / (sqrt(3) * TARGET_VISIBLE_COLUMNS)`, clamped to `[MIN_HEX_SIZE, MAX_HEX_SIZE]`. `viewportHeight` is accepted for symmetry and future use but does not currently affect the result — width is what determines how many countries are visible side by side, which is the dimension that felt "tiny" on a wide/large display.

`AtlasLayout` (`src/atlas/layout.ts`) becomes the single owner of the *current* hex size:

- Constructor gains a third, optional parameter: `constructor(countries, genres, hexSize: number = HEX_SIZE)`. Existing 2-arg call sites (all current tests) are unaffected.
- A `get hexSize(): number` and a `setHexSize(size: number): void` replace the bare private field access.
- `widthPx`/`heightPx` read the instance's current `hexSize` instead of the imported `HEX_SIZE` constant.

`HEX_SIZE` in `hex.ts` is unchanged and keeps its role as the default value for `axialToPixel`/`pixelToAxial`/`visibleOffsets`/`requiredCellKeys`'s optional `size` parameter — used by tests and as a fallback. The live app stops relying on that default and passes `layout.hexSize` explicitly at every call site that currently omits it.

## Call sites to update

In `src/render/canvas.ts`'s `AtlasRenderer`:

- `hoverAt()`: `pixelToAxial(world)` → `pixelToAxial(world, this.layout.hexSize)`
- `draw()`: both `axialToPixel(offsetToAxial({col,row}))` calls → pass `this.layout.hexSize` as the second argument; `visibleOffsets(rect, this.layout)` → add `this.layout.hexSize`; `requiredCellKeys(rect, this.layout)` → add `this.layout.hexSize` (keeping the existing default `ring`)
- Tile size: `HEX_SIZE * TILE_GAP` (both `drawTile` calls) → `this.layout.hexSize * TILE_GAP`
- `HOVER_SCALE`: `1.45` → `1.8`

`src/ui/minimap.ts` needs no changes — it already reads `layout.widthPx`/`heightPx` for its scale factors, which will reflect the live `hexSize` automatically. `src/atlas/viewport.ts`'s `clampView` needs no signature change for the same reason (it derives bounds from `layout.widthPx`/`heightPx`). Search's jump-to (`layout.centreOf`) needs no change either — it already calls `axialToPixel`/`offsetToAxial` without an explicit size in `layout.ts`, so `centreOf` picks up an implicit-default-size bug **unless** it's also updated to pass `this.hexSize` — this must be fixed as part of the `AtlasLayout` change (call `axialToPixel(offsetToAxial(...), this.hexSize)` inside `centreOf`), otherwise jump-to would target the wrong pixel position once the live hex size diverges from the default 34.

## Data flow

**Boot** (`src/main.ts`): compute the initial size before constructing the layout —
```ts
const layout = new AtlasLayout(
  manifest.countries,
  manifest.genres.map((g) => g.id),
  computeHexSize(window.innerWidth, window.innerHeight),
)
```

**Resize** (`AtlasRenderer.resize()`, `src/render/canvas.ts`): currently only resizes the canvas backing store. Extend it to:
1. Compute `newSize = computeHexSize(window.innerWidth, window.innerHeight)`.
2. Capture `oldSize = this.layout.hexSize` before changing it.
3. `this.layout.setHexSize(newSize)`.
4. Rescale the current pan position proportionally: `this.view = { x: this.view.x * (newSize / oldSize), y: this.view.y * (newSize / oldSize) }`, then `clampView` it against the layout's new `widthPx`/`heightPx`. This keeps the user's current view roughly centred on the same world position instead of jumping to the origin or an arbitrary offset purely because the window resized.
5. Continue with the existing backing-store/style resize and `invalidate()`.

No other module (pointer, touch, minimap, search, main.ts wiring) needs to change beyond this — they all route through `layout` or `renderer`, not `HEX_SIZE` directly (confirmed: no other file imports `HEX_SIZE`).

## Testing

- `tests/scale.test.ts` (new): `computeHexSize` — the target-column formula at a typical width (e.g. 1920 → a size within the clamped range), the low clamp on a narrow viewport, the high clamp on a very wide one (e.g. the 7680px case that motivated this).
- `tests/layout.test.ts`: extend to cover the 3-arg constructor, `hexSize` getter/setter, and that `widthPx`/`heightPx`/`centreOf` reflect a changed `hexSize` after `setHexSize()`.
- `tests/renderer.test.ts`: extend to confirm `resize()` updates `layout.hexSize` and rescales `view` proportionally (a fake/stub window size can drive this deterministically in jsdom).
- No changes needed to `tests/hex.test.ts` or `tests/viewport.test.ts` — those already parameterize on `size` and keep testing the pure math independent of any particular size value.
- Manual verification: resize the browser window and confirm the grid visibly grows/shrinks, the current pan position doesn't jump, and the hover pop-out (1.8x) is clearly larger than its neighbors.

## Edge cases

- Very narrow window (e.g. an embedded iframe): clamps to `MIN_HEX_SIZE` rather than shrinking indefinitely.
- Very wide/high-res window: clamps to `MAX_HEX_SIZE` rather than growing indefinitely (this is what fixes the 7680px-wide sandbox case, and would equally apply to a real ultrawide monitor).
- Resizing mid-pan: view rescales proportionally rather than resetting, so the user doesn't lose their place.
- Search/minimap jump-to targets: must resolve through the live `layout.hexSize` (via the `centreOf` fix above), not a stale default, or a jump right after a resize would land at the wrong pixel position.

## Out of scope (explicitly deferred)

- The reference site's cursor-following spotlight/lens and dimmed-surroundings effect — not part of this round.
- A user-facing manual zoom control.
- Investigating why some tiles show gradient-fallback colors instead of real album art (separate, data/loading concern — not a rendering-size issue).
