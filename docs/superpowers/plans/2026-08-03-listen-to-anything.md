# Listen to Anything — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A full-screen hex honeycomb of album art where settling the cursor on a tile plays a 30-second preview; horizontal position is country, vertical position is genre.

**Architecture:** An offline Node harvest walks 1,200 country×genre cells from Apple's public feeds and writes one small JSON file per cell into `public/data/`. The browser app reads only those static files — it never calls a music API — and renders visible hexes to a single canvas, lazy-loading cells as the viewport drifts.

**Tech Stack:** Vite 5, TypeScript 5 (strict), Vitest (unit), Playwright (smoke), plain DOM + Canvas 2D. No UI framework.

**Spec:** `docs/superpowers/specs/2026-08-03-listen-to-anything-design.md`

## Global Constraints

- **Node 20+**, npm. TypeScript `strict: true`, no `any` in committed code.
- **No UI framework in `src/`** — plain TS + DOM + Canvas 2D.
- **The browser makes zero music-API calls.** `src/` may only `fetch()` paths under `/data/`. A test enforces this.
- **Nothing is re-hosted.** Artwork and audio are hotlinked to provider CDNs. Never download, proxy, or store media files.
- **Genre labels come from the fixed English taxonomy in `harvest/taxonomy.ts`, keyed by numeric genre id — never from feed text** (feed titles are localized).
- Atlas geometry: `CELL_COLS = 5`, `CELL_ROWS = 10`, `SONGS_PER_CELL = 50`, `HEX_SIZE = 34`.
- v1 axes: **40 countries × 30 genres = 1,200 cells = 60,000 songs** (Appendix A of the spec).
- Audio tuning: `HOVER_DEBOUNCE_MS = 180`, `CROSSFADE_MS = 250`, `IMAGE_CACHE_CAPACITY = 600`.
- `SCHEMA_VERSION = 1` in the manifest; the app refuses to boot on a mismatch.
- Commit after every task. Conventional commit prefixes (`feat:`, `test:`, `chore:`).

## File Structure

```
harvest/                     Node-only. Never imported by src/.
  types.ts                   Song, Manifest, GenreId, SCHEMA_VERSION, cellKey  ← shared with src/
  taxonomy.ts                COUNTRIES[40], GENRES[30] — the axis definitions
  rateLimit.ts               token bucket
  normalize.ts               RawEntry → Song
  dedupe.ts                  collapse duplicates across sources
  sources/itunes.ts          fetchCell + storefront health check + RSS fallback
  sources/deezer.ts          gap filler            (Milestone 6)
  sources/jamendo.ts         CC long tail          (Milestone 6)
  emit.ts                    shard writer + manifest writer
  run.ts                     resumable CLI entrypoint
  fixtures/                  recorded API responses — tests never hit the network
src/
  types.ts                   re-export from harvest/types.ts
  atlas/hex.ts               axial ↔ offset ↔ pixel math
  atlas/layout.ts            AtlasLayout: offset → Slot
  atlas/viewport.ts          visible range, required cell keys
  data/loader.ts             CellStore, loadManifest
  render/imageCache.ts       LRU image cache + gradient fallback
  render/tile.ts             draw one hex
  render/canvas.ts           AtlasRenderer, dirty-redraw loop
  audio/engine.ts            AudioEngine: 2 elements, crossfade, debounce
  audio/unlock.ts            autoplay unlock overlay
  ui/axisLabels.ts           persistent country/genre HUD
  ui/nowPlaying.ts           pinned-song detail card
  ui/minimap.ts              overview + viewport rect
  ui/search.ts               fuzzy jump-to
  input/pointer.ts           desktop hover + drag
  input/touch.ts             mobile fallback
  main.ts                    wiring
public/data/                 harvest output (gitignored except .gitkeep)
tests/                       unit + smoke
```

**Boundary rule:** `harvest/` imports nothing from `src/`. `src/` imports only `harvest/types.ts` and `harvest/taxonomy.ts` (both pure data/type modules with no Node dependencies).

---

## Milestone 0 — Foundation

### Task 1: Replace the Kotlin scaffold with a Vite + TypeScript project

**Files:**
- Delete: `.idea/`, `Listen to anything.iml`, empty `src/`
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `.gitignore` (append), `public/data/.gitkeep`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: a working `npm run dev`, `npm test`, `npm run build`; a git repo on branch `main`

> **Destructive step — confirm with the user before running Step 1.** The `.idea/` directory and `.iml` file are the only existing content besides the (empty) `src/` and the docs.

- [ ] **Step 1: Remove the Kotlin scaffold and initialise git**

```bash
cd "D:/Projects/Listen to anything"
rm -rf .idea "Listen to anything.iml"
rm -rf src            # confirmed empty
git init -b main
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "listen-to-anything",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "harvest": "tsx harvest/run.ts"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vite": "^5.3.0",
    "vitest": "^2.0.0"
  }
}
```

Run: `npm install`

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"]
  },
  "include": ["src", "harvest", "tests", "vite.config.ts"]
}
```

- [ ] **Step 4: Create `vite.config.ts`, `index.html`, `src/main.ts`**

`vite.config.ts`:
```ts
import { defineConfig } from 'vite'

export default defineConfig({
  test: { globals: true, environment: 'jsdom' },
})
```

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Listen to Anything</title>
    <style>
      html, body { margin: 0; height: 100%; background: #07070c; overflow: hidden; }
      canvas { display: block; }
    </style>
  </head>
  <body>
    <canvas id="atlas"></canvas>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/main.ts`:
```ts
const canvas = document.querySelector<HTMLCanvasElement>('#atlas')
if (!canvas) throw new Error('missing #atlas canvas')
canvas.width = window.innerWidth
canvas.height = window.innerHeight
```

Install the jsdom environment: `npm i -D jsdom`

- [ ] **Step 5: Write a smoke test**

`tests/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

describe('project setup', () => {
  it('runs TypeScript under vitest', () => {
    const answer: number = 2 + 2
    expect(answer).toBe(4)
  })
})
```

- [ ] **Step 6: Verify the toolchain**

Run: `npm test`
Expected: 1 passing test.

Run: `npm run build`
Expected: `tsc --noEmit` clean, then a `dist/` build with no errors.

- [ ] **Step 7: Append to `.gitignore` and commit**

Append to the existing `.gitignore`:
```
### Node
node_modules/
dist/
public/data/*
!public/data/.gitkeep
```

```bash
mkdir -p public/data && touch public/data/.gitkeep
git add -A
git commit -m "chore: replace Kotlin scaffold with Vite + TypeScript project"
```

---

## Milestone 1 — Atlas mathematics

Pure functions, zero I/O. This milestone is the highest-value TDD target in the plan: every bug here becomes a visual glitch that is miserable to debug later.

### Task 2: Shared types and the axis taxonomy

**Files:**
- Create: `harvest/types.ts`, `harvest/taxonomy.ts`, `src/types.ts`
- Test: `tests/taxonomy.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type GenreId = number`
  - `type Song`, `type Manifest`, `type CellStats`
  - `const SCHEMA_VERSION = 1`
  - `function cellKey(country: string, genre: GenreId): string`
  - `const COUNTRIES: readonly string[]` (40), `const GENRES: readonly { id: GenreId; label: string }[]` (30)

- [ ] **Step 1: Write the failing test**

`tests/taxonomy.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { COUNTRIES, GENRES } from '../harvest/taxonomy'
import { cellKey, SCHEMA_VERSION } from '../harvest/types'

describe('taxonomy', () => {
  it('has exactly 40 countries, all unique lowercase ISO-3166 alpha-2', () => {
    expect(COUNTRIES).toHaveLength(40)
    expect(new Set(COUNTRIES).size).toBe(40)
    for (const c of COUNTRIES) expect(c).toMatch(/^[a-z]{2}$/)
  })

  it('has exactly 30 genres with unique numeric ids and English labels', () => {
    expect(GENRES).toHaveLength(30)
    expect(new Set(GENRES.map((g) => g.id)).size).toBe(30)
    for (const g of GENRES) {
      expect(Number.isInteger(g.id)).toBe(true)
      expect(g.label.length).toBeGreaterThan(0)
    }
  })

  it('builds a stable cell key', () => {
    expect(cellKey('br', 1122)).toBe('br-1122')
  })

  it('pins the schema version', () => {
    expect(SCHEMA_VERSION).toBe(1)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/taxonomy.test.ts`
Expected: FAIL — cannot resolve `../harvest/taxonomy`.

- [ ] **Step 3: Write `harvest/types.ts`**

```ts
export type GenreId = number

export type SourceName = 'itunes' | 'deezer' | 'jamendo'

export type Song = {
  id: string
  title: string
  artist: string
  album?: string
  art: string
  preview: string
  previewType: 'aac' | 'mp3'
  genre: GenreId
  country: string
  source: SourceName
  link: string
  yt: string
}

export type CellStats = { count: number; thin?: boolean }

export type Manifest = {
  schemaVersion: number
  harvestedAt: string
  countries: string[]
  genres: { id: GenreId; label: string }[]
  cells: Record<string, CellStats>
}

export const SCHEMA_VERSION = 1

/**
 * Atlas geometry. Lives here rather than in src/atlas/layout.ts because the
 * harvest needs it too, and harvest/ must never import from src/.
 */
export const CELL_COLS = 5
export const CELL_ROWS = 10
export const SONGS_PER_CELL = CELL_COLS * CELL_ROWS

export function cellKey(country: string, genre: GenreId): string {
  return `${country}-${genre}`
}
```

- [ ] **Step 4: Write `harvest/taxonomy.ts`**

Order is meaningful: countries run west→east so adjacent columns are regional neighbours; genres are grouped by family so adjacent rows are related styles. Genre ids are Apple's, verified live on 2026-08-03.

```ts
import type { GenreId } from './types'

/** West → east, grouped by region. Column order in the atlas. */
export const COUNTRIES: readonly string[] = [
  // Americas
  'us', 'ca', 'mx', 'co', 'pe', 'cl', 'ar', 'br',
  // Western Europe
  'pt', 'es', 'ie', 'gb', 'fr', 'nl', 'de', 'it',
  // Nordics
  'dk', 'no', 'se', 'fi',
  // Eastern Europe
  'pl', 'tr', 'ru',
  // Middle East & Africa
  'sa', 'ae', 'eg', 'ng', 'ke', 'za',
  // Asia
  'in', 'th', 'vn', 'id', 'ph', 'cn', 'tw', 'kr', 'jp',
  // Oceania
  'au', 'nz',
]

/** Grouped by family. Row order in the atlas. Ids are Apple's numeric genre ids. */
export const GENRES: readonly { id: GenreId; label: string }[] = [
  // Popular
  { id: 14, label: 'Pop' },
  { id: 20, label: 'Alternative' },
  { id: 21, label: 'Rock' },
  { id: 10, label: 'Singer/Songwriter' },
  { id: 1289, label: 'Folk' },
  // Urban
  { id: 18, label: 'Hip-Hop/Rap' },
  { id: 15, label: 'R&B/Soul' },
  { id: 24, label: 'Reggae' },
  // Electronic
  { id: 7, label: 'Electronic' },
  { id: 17, label: 'Dance' },
  // Roots
  { id: 6, label: 'Country' },
  { id: 2, label: 'Blues' },
  { id: 11, label: 'Jazz' },
  // Classical & instrumental
  { id: 5, label: 'Classical' },
  { id: 16, label: 'Soundtrack' },
  { id: 53, label: 'Instrumental' },
  { id: 13, label: 'New Age' },
  { id: 25, label: 'Easy Listening' },
  { id: 23, label: 'Vocal' },
  // Faith
  { id: 22, label: 'Christian' },
  // Regional
  { id: 12, label: 'Latin' },
  { id: 1122, label: 'Brazilian' },
  { id: 1203, label: 'African' },
  { id: 1197, label: 'Arabic' },
  { id: 1300, label: 'Turkish' },
  { id: 1262, label: 'Indian' },
  { id: 1232, label: 'Chinese' },
  { id: 1243, label: 'Korean' },
  { id: 27, label: 'J-Pop' },
  { id: 19, label: 'Worldwide' },
]
```

- [ ] **Step 5: Write `src/types.ts`**

```ts
export type { GenreId, Song, Manifest, CellStats, SourceName } from '../harvest/types'
export { SCHEMA_VERSION, cellKey, CELL_COLS, CELL_ROWS, SONGS_PER_CELL } from '../harvest/types'
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/taxonomy.test.ts`
Expected: 4 passing.

- [ ] **Step 7: Commit**

```bash
git add harvest/types.ts harvest/taxonomy.ts src/types.ts tests/taxonomy.test.ts
git commit -m "feat: add shared types and the 40x30 axis taxonomy"
```

### Task 3: Hex coordinate mathematics

Pointy-top hexes. Two coordinate systems: **odd-r offset** `(col, row)` for layout — so a country column is a visually straight column — and **axial** `(q, r)` for pixel conversion. Mixing them up is the classic bug; the round-trip property tests below exist to catch it.

**Files:**
- Create: `src/atlas/hex.ts`
- Test: `tests/hex.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type Axial = { q: number; r: number }`, `type Offset = { col: number; row: number }`, `type Point = { x: number; y: number }`
  - `const HEX_SIZE = 34`
  - `offsetToAxial(o: Offset): Axial`, `axialToOffset(a: Axial): Offset`
  - `axialToPixel(a: Axial, size?: number): Point`, `pixelToAxial(p: Point, size?: number): Axial`
  - `axialRound(qf: number, rf: number): Axial`

- [ ] **Step 1: Write the failing tests**

`tests/hex.test.ts`:
```ts
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
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/hex.test.ts`
Expected: FAIL — cannot resolve `../src/atlas/hex`.

- [ ] **Step 3: Implement `src/atlas/hex.ts`**

```ts
export type Axial = { q: number; r: number }
export type Offset = { col: number; row: number }
export type Point = { x: number; y: number }

/** Distance from a hex centre to a corner, in CSS pixels. */
export const HEX_SIZE = 34

const SQRT3 = Math.sqrt(3)

/**
 * odd-r offset → axial. Works for negative rows: in JS, (-3 & 1) === 1,
 * which is exactly the parity we want.
 */
export function offsetToAxial(o: Offset): Axial {
  return { q: o.col - (o.row - (o.row & 1)) / 2, r: o.row }
}

export function axialToOffset(a: Axial): Offset {
  return { col: a.q + (a.r - (a.r & 1)) / 2, row: a.r }
}

export function axialToPixel(a: Axial, size: number = HEX_SIZE): Point {
  return {
    x: size * SQRT3 * (a.q + a.r / 2),
    y: size * 1.5 * a.r,
  }
}

export function pixelToAxial(p: Point, size: number = HEX_SIZE): Axial {
  const qf = ((SQRT3 / 3) * p.x - p.y / 3) / size
  const rf = ((2 / 3) * p.y) / size
  return axialRound(qf, rf)
}

/** Cube rounding: round all three axes, then correct the one that moved most. */
export function axialRound(qf: number, rf: number): Axial {
  const xf = qf
  const zf = rf
  const yf = -xf - zf

  let x = Math.round(xf)
  let y = Math.round(yf)
  let z = Math.round(zf)

  const dx = Math.abs(x - xf)
  const dy = Math.abs(y - yf)
  const dz = Math.abs(z - zf)

  if (dx > dy && dx > dz) x = -y - z
  else if (dy > dz) y = -x - z
  else z = -x - y

  return { q: x, r: z }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/hex.test.ts`
Expected: 6 passing. The two round-trip tests cover 1,681 and 1,600 coordinate pairs respectively.

- [ ] **Step 5: Commit**

```bash
git add src/atlas/hex.ts tests/hex.test.ts
git commit -m "feat: add pointy-top hex coordinate mathematics"
```

### Task 4: Atlas layout — mapping hexes to songs

Every hex on the plane belongs to exactly one (country, genre) cell and one song index within it. This is the heart of the two-axis atlas.

**Files:**
- Create: `src/atlas/layout.ts`
- Test: `tests/layout.test.ts`

**Interfaces:**
- Consumes: `Offset` from `src/atlas/hex.ts`; `GenreId`, `cellKey` from `src/types.ts`
- Produces:
  - `const CELL_COLS = 5`, `const CELL_ROWS = 10`, `const SONGS_PER_CELL = 50`
  - `type CellRef = { country: string; genre: GenreId }`
  - `type Slot = { country: string; genre: GenreId; index: number }`
  - `class AtlasLayout` with `.cols`, `.rows`, `.widthPx`, `.heightPx`, `slotAt(o: Offset): Slot | null`, `cellOrigin(c: CellRef): Offset | null`, `centreOf(c: CellRef): Point | null`

- [ ] **Step 1: Write the failing tests**

`tests/layout.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { AtlasLayout, CELL_COLS, CELL_ROWS, SONGS_PER_CELL } from '../src/atlas/layout'

const COUNTRIES = ['us', 'br', 'ng']
const GENRES = [14, 18, 21]
const layout = new AtlasLayout(COUNTRIES, GENRES)

describe('AtlasLayout', () => {
  it('sizes the atlas from the axis lengths', () => {
    expect(layout.cols).toBe(3 * CELL_COLS)   // 15
    expect(layout.rows).toBe(3 * CELL_ROWS)   // 30
    expect(SONGS_PER_CELL).toBe(CELL_COLS * CELL_ROWS)
  })

  it('puts the first hex in the first country and first genre', () => {
    expect(layout.slotAt({ col: 0, row: 0 })).toEqual({ country: 'us', genre: 14, index: 0 })
  })

  it('changes country as you move horizontally', () => {
    expect(layout.slotAt({ col: CELL_COLS, row: 0 })?.country).toBe('br')
    expect(layout.slotAt({ col: 2 * CELL_COLS, row: 0 })?.country).toBe('ng')
  })

  it('changes genre as you move vertically', () => {
    expect(layout.slotAt({ col: 0, row: CELL_ROWS })?.genre).toBe(18)
    expect(layout.slotAt({ col: 0, row: 2 * CELL_ROWS })?.genre).toBe(21)
  })

  it('indexes songs row-major inside a cell', () => {
    expect(layout.slotAt({ col: 1, row: 0 })?.index).toBe(1)
    expect(layout.slotAt({ col: 0, row: 1 })?.index).toBe(CELL_COLS)
    expect(layout.slotAt({ col: CELL_COLS - 1, row: CELL_ROWS - 1 })?.index).toBe(SONGS_PER_CELL - 1)
  })

  it('returns null outside the atlas', () => {
    expect(layout.slotAt({ col: -1, row: 0 })).toBeNull()
    expect(layout.slotAt({ col: 0, row: -1 })).toBeNull()
    expect(layout.slotAt({ col: layout.cols, row: 0 })).toBeNull()
    expect(layout.slotAt({ col: 0, row: layout.rows })).toBeNull()
  })

  it('covers every hex exactly once, with no duplicate song slots', () => {
    const seen = new Set<string>()
    for (let col = 0; col < layout.cols; col++) {
      for (let row = 0; row < layout.rows; row++) {
        const slot = layout.slotAt({ col, row })
        expect(slot).not.toBeNull()
        const key = `${slot!.country}-${slot!.genre}-${slot!.index}`
        expect(seen.has(key)).toBe(false)
        seen.add(key)
      }
    }
    expect(seen.size).toBe(COUNTRIES.length * GENRES.length * SONGS_PER_CELL)
  })

  it('round-trips a cell origin back to that cell', () => {
    const origin = layout.cellOrigin({ country: 'br', genre: 18 })
    expect(origin).toEqual({ col: CELL_COLS, row: CELL_ROWS })
    const slot = layout.slotAt(origin!)
    expect(slot).toEqual({ country: 'br', genre: 18, index: 0 })
  })

  it('returns null for a cell outside the axes', () => {
    expect(layout.cellOrigin({ country: 'zz', genre: 14 })).toBeNull()
    expect(layout.cellOrigin({ country: 'us', genre: 9999 })).toBeNull()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/layout.test.ts`
Expected: FAIL — cannot resolve `../src/atlas/layout`.

- [ ] **Step 3: Implement `src/atlas/layout.ts`**

```ts
import { axialToPixel, offsetToAxial, HEX_SIZE, type Offset, type Point } from './hex'
import { CELL_COLS, CELL_ROWS, SONGS_PER_CELL, type GenreId } from '../types'

// Re-exported so atlas consumers import geometry from one place.
export { CELL_COLS, CELL_ROWS, SONGS_PER_CELL }

export type CellRef = { country: string; genre: GenreId }
export type Slot = { country: string; genre: GenreId; index: number }

export class AtlasLayout {
  readonly countries: readonly string[]
  readonly genres: readonly GenreId[]
  readonly cols: number
  readonly rows: number

  private readonly countryIndex: Map<string, number>
  private readonly genreIndex: Map<GenreId, number>

  constructor(countries: readonly string[], genres: readonly GenreId[]) {
    this.countries = countries
    this.genres = genres
    this.cols = countries.length * CELL_COLS
    this.rows = genres.length * CELL_ROWS
    this.countryIndex = new Map(countries.map((c, i) => [c, i]))
    this.genreIndex = new Map(genres.map((g, i) => [g, i]))
  }

  /** Total atlas size in world pixels, used by the minimap and pan clamping. */
  get widthPx(): number {
    return Math.sqrt(3) * HEX_SIZE * (this.cols + 0.5)
  }

  get heightPx(): number {
    return 1.5 * HEX_SIZE * (this.rows + 1)
  }

  slotAt(o: Offset): Slot | null {
    if (o.col < 0 || o.col >= this.cols) return null
    if (o.row < 0 || o.row >= this.rows) return null

    const ci = Math.floor(o.col / CELL_COLS)
    const gi = Math.floor(o.row / CELL_ROWS)
    const country = this.countries[ci]
    const genre = this.genres[gi]
    if (country === undefined || genre === undefined) return null

    const localCol = o.col - ci * CELL_COLS
    const localRow = o.row - gi * CELL_ROWS
    return { country, genre, index: localRow * CELL_COLS + localCol }
  }

  cellOrigin(c: CellRef): Offset | null {
    const ci = this.countryIndex.get(c.country)
    const gi = this.genreIndex.get(c.genre)
    if (ci === undefined || gi === undefined) return null
    return { col: ci * CELL_COLS, row: gi * CELL_ROWS }
  }

  /** World-pixel centre of a cell — used by search to jump the viewport. */
  centreOf(c: CellRef): Point | null {
    const origin = this.cellOrigin(c)
    if (!origin) return null
    return axialToPixel(
      offsetToAxial({
        col: origin.col + Math.floor(CELL_COLS / 2),
        row: origin.row + Math.floor(CELL_ROWS / 2),
      }),
    )
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/layout.test.ts`
Expected: 9 passing. The coverage test walks all 450 hexes of the 3×3 fixture and asserts a bijection onto song slots.

- [ ] **Step 5: Commit**

```bash
git add src/atlas/layout.ts tests/layout.test.ts
git commit -m "feat: map hexes to country/genre cells and song indices"
```

### Task 5: Viewport — what is visible and what to preload

**Files:**
- Create: `src/atlas/viewport.ts`
- Test: `tests/viewport.test.ts`

**Interfaces:**
- Consumes: `AtlasLayout`, `CELL_COLS`, `CELL_ROWS` from `src/atlas/layout.ts`; `HEX_SIZE`, `axialToPixel`, `offsetToAxial` from `src/atlas/hex.ts`; `cellKey` from `src/types.ts`
- Produces:
  - `type Rect = { x: number; y: number; w: number; h: number }`
  - `type OffsetRange = { colMin: number; colMax: number; rowMin: number; rowMax: number }`
  - `visibleOffsets(view: Rect, layout: AtlasLayout, size?: number): OffsetRange`
  - `requiredCellKeys(view: Rect, layout: AtlasLayout, ring?: number, size?: number): string[]`
  - `clampView(view: Rect, layout: AtlasLayout): Point`

- [ ] **Step 1: Write the failing tests**

`tests/viewport.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { AtlasLayout, CELL_COLS, CELL_ROWS } from '../src/atlas/layout'
import { visibleOffsets, requiredCellKeys, clampView } from '../src/atlas/viewport'
import { axialToPixel, offsetToAxial, HEX_SIZE } from '../src/atlas/hex'

const layout = new AtlasLayout(['us', 'br', 'ng', 'jp'], [14, 18, 21])

describe('visibleOffsets', () => {
  it('includes the hex at the top-left of the view', () => {
    const range = visibleOffsets({ x: 0, y: 0, w: 400, h: 300 }, layout)
    expect(range.colMin).toBe(0)
    expect(range.rowMin).toBe(0)
  })

  it('never returns offsets outside the atlas', () => {
    const range = visibleOffsets({ x: -1000, y: -1000, w: 200, h: 200 }, layout)
    expect(range.colMin).toBeGreaterThanOrEqual(0)
    expect(range.rowMin).toBeGreaterThanOrEqual(0)
    expect(range.colMax).toBeLessThan(layout.cols)
    expect(range.rowMax).toBeLessThan(layout.rows)
  })

  it('covers every hex whose centre lies inside the view', () => {
    const view = { x: 120, y: 90, w: 500, h: 400 }
    const range = visibleOffsets(view, layout)
    for (let col = 0; col < layout.cols; col++) {
      for (let row = 0; row < layout.rows; row++) {
        const p = axialToPixel(offsetToAxial({ col, row }))
        const inside =
          p.x >= view.x && p.x <= view.x + view.w && p.y >= view.y && p.y <= view.y + view.h
        if (inside) {
          expect(col).toBeGreaterThanOrEqual(range.colMin)
          expect(col).toBeLessThanOrEqual(range.colMax)
          expect(row).toBeGreaterThanOrEqual(range.rowMin)
          expect(row).toBeLessThanOrEqual(range.rowMax)
        }
      }
    }
  })
})

describe('requiredCellKeys', () => {
  it('returns the visible cell plus a one-cell prefetch ring', () => {
    // A tiny view parked inside the second country / second genre cell.
    const p = axialToPixel(offsetToAxial({ col: CELL_COLS + 2, row: CELL_ROWS + 5 }))
    const keys = requiredCellKeys({ x: p.x, y: p.y, w: 1, h: 1 }, layout, 1)
    expect(keys).toContain('br-18')     // the visible cell
    expect(keys).toContain('us-18')     // ring: west
    expect(keys).toContain('ng-18')     // ring: east
    expect(keys).toContain('br-14')     // ring: north
    expect(keys).toContain('br-21')     // ring: south
    expect(keys).not.toContain('jp-18') // two cells east — outside the ring
  })

  it('returns unique keys', () => {
    const keys = requiredCellKeys({ x: 0, y: 0, w: 2000, h: 2000 }, layout, 1)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('does not invent cells beyond the axes', () => {
    const keys = requiredCellKeys({ x: 0, y: 0, w: 50, h: 50 }, layout, 1)
    for (const k of keys) {
      const [country, genre] = k.split('-')
      expect(layout.countries).toContain(country)
      expect(layout.genres).toContain(Number(genre))
    }
  })
})

describe('clampView', () => {
  it('stops panning past the north-west corner', () => {
    const p = clampView({ x: -500, y: -500, w: 300, h: 300 }, layout)
    expect(p.x).toBe(0)
    expect(p.y).toBe(0)
  })

  it('stops panning past the south-east corner', () => {
    const p = clampView({ x: 1e6, y: 1e6, w: 300, h: 300 }, layout)
    expect(p.x).toBeCloseTo(layout.widthPx - 300, 6)
    expect(p.y).toBeCloseTo(layout.heightPx - 300, 6)
  })

  it('leaves a view that already fits alone', () => {
    const p = clampView({ x: 40, y: 30, w: 200, h: 150 }, layout)
    expect(p).toEqual({ x: 40, y: 30 })
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/viewport.test.ts`
Expected: FAIL — cannot resolve `../src/atlas/viewport`.

- [ ] **Step 3: Implement `src/atlas/viewport.ts`**

```ts
import { axialToOffset, pixelToAxial, HEX_SIZE, type Point } from './hex'
import { AtlasLayout, CELL_COLS, CELL_ROWS } from './layout'
import { cellKey } from '../types'

export type Rect = { x: number; y: number; w: number; h: number }
export type OffsetRange = { colMin: number; colMax: number; rowMin: number; rowMax: number }

/**
 * One hex of slack on every side. A hex centre can sit just outside the view
 * while the hex itself is still partly on screen, so we always over-scan by one.
 */
const SLACK = 1

export function visibleOffsets(
  view: Rect,
  layout: AtlasLayout,
  size: number = HEX_SIZE,
): OffsetRange {
  const corners: Point[] = [
    { x: view.x, y: view.y },
    { x: view.x + view.w, y: view.y },
    { x: view.x, y: view.y + view.h },
    { x: view.x + view.w, y: view.y + view.h },
  ]

  let colMin = Infinity
  let colMax = -Infinity
  let rowMin = Infinity
  let rowMax = -Infinity

  for (const c of corners) {
    const { col, row } = axialToOffset(pixelToAxial(c, size))
    colMin = Math.min(colMin, col)
    colMax = Math.max(colMax, col)
    rowMin = Math.min(rowMin, row)
    rowMax = Math.max(rowMax, row)
  }

  return {
    colMin: Math.max(0, colMin - SLACK),
    colMax: Math.min(layout.cols - 1, colMax + SLACK),
    rowMin: Math.max(0, rowMin - SLACK),
    rowMax: Math.min(layout.rows - 1, rowMax + SLACK),
  }
}

export function requiredCellKeys(
  view: Rect,
  layout: AtlasLayout,
  ring: number = 1,
  size: number = HEX_SIZE,
): string[] {
  const range = visibleOffsets(view, layout, size)

  const ciMin = Math.floor(range.colMin / CELL_COLS) - ring
  const ciMax = Math.floor(range.colMax / CELL_COLS) + ring
  const giMin = Math.floor(range.rowMin / CELL_ROWS) - ring
  const giMax = Math.floor(range.rowMax / CELL_ROWS) + ring

  const keys: string[] = []
  for (let gi = giMin; gi <= giMax; gi++) {
    for (let ci = ciMin; ci <= ciMax; ci++) {
      const country = layout.countries[ci]
      const genre = layout.genres[gi]
      if (country === undefined || genre === undefined) continue
      keys.push(cellKey(country, genre))
    }
  }
  return keys
}

/** Keep the view inside the atlas. If the atlas is smaller than the view, pin to 0. */
export function clampView(view: Rect, layout: AtlasLayout): Point {
  const maxX = Math.max(0, layout.widthPx - view.w)
  const maxY = Math.max(0, layout.heightPx - view.h)
  return {
    x: Math.min(Math.max(view.x, 0), maxX),
    y: Math.min(Math.max(view.y, 0), maxY),
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/viewport.test.ts`
Expected: 9 passing.

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test`
Expected: all tests from Tasks 1–5 pass.

```bash
git add src/atlas/viewport.ts tests/viewport.test.ts
git commit -m "feat: compute visible hexes, prefetch ring, and pan clamping"
```

**Milestone 1 complete.** The atlas is fully specified as pure functions with no I/O, no DOM, and no network. Every subsequent milestone builds on tested foundations.

---

## Milestone 2 — The harvest

Runs on Node only. Tests never touch the network — they run against recorded fixtures.

### Task 6: Token-bucket rate limiter

**Files:**
- Create: `harvest/rateLimit.ts`
- Test: `tests/rateLimit.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `class TokenBucket` with `constructor(ratePerSec: number, burst: number)` and `take(): Promise<void>`

- [ ] **Step 1: Write the failing test**

`tests/rateLimit.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TokenBucket } from '../harvest/rateLimit'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('TokenBucket', () => {
  it('allows the burst immediately', async () => {
    const bucket = new TokenBucket(5, 3)
    const done: number[] = []
    for (let i = 0; i < 3; i++) void bucket.take().then(() => done.push(i))
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toEqual([0, 1, 2])
  })

  it('delays the request that exceeds the burst', async () => {
    const bucket = new TokenBucket(5, 1) // 1 token, refills at 5/sec = 200ms each
    const done: number[] = []
    void bucket.take().then(() => done.push(0))
    void bucket.take().then(() => done.push(1))

    await vi.advanceTimersByTimeAsync(0)
    expect(done).toEqual([0])

    await vi.advanceTimersByTimeAsync(200)
    expect(done).toEqual([0, 1])
  })

  it('serialises a queue in order', async () => {
    const bucket = new TokenBucket(10, 1) // 100ms per token
    const done: number[] = []
    for (let i = 0; i < 4; i++) void bucket.take().then(() => done.push(i))
    await vi.advanceTimersByTimeAsync(1000)
    expect(done).toEqual([0, 1, 2, 3])
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/rateLimit.test.ts`
Expected: FAIL — cannot resolve `../harvest/rateLimit`.

- [ ] **Step 3: Implement `harvest/rateLimit.ts`**

```ts
/**
 * Simple token bucket. One instance per upstream source keeps us politely
 * under rate limits without needing to think about concurrency at call sites.
 */
export class TokenBucket {
  private tokens: number
  private last: number
  private queue: Array<() => void> = []
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly ratePerSec: number,
    private readonly burst: number,
  ) {
    this.tokens = burst
    this.last = Date.now()
  }

  take(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.queue.push(resolve)
      this.pump()
    })
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = (now - this.last) / 1000
    this.last = now
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.ratePerSec)
  }

  private pump(): void {
    this.refill()

    while (this.tokens >= 1 && this.queue.length > 0) {
      this.tokens -= 1
      const resolve = this.queue.shift()!
      resolve()
    }

    if (this.queue.length > 0 && this.timer === null) {
      const waitMs = Math.ceil(((1 - this.tokens) / this.ratePerSec) * 1000)
      this.timer = setTimeout(() => {
        this.timer = null
        this.pump()
      }, Math.max(waitMs, 1))
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/rateLimit.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add harvest/rateLimit.ts tests/rateLimit.test.ts
git commit -m "feat: add token-bucket rate limiter for harvest sources"
```

### Task 7: Normalising iTunes entries into `Song`

Two real-world quirks discovered during spec research are handled here, and both have tests:
1. **A feed with exactly one entry returns `entry` as an object, not an array.** This is what the `kr` storefront does. Un-arrayed input silently produces zero songs if not handled.
2. **Artwork URLs are 170px but resize by string substitution** — `/170x170bb.png` → `/600x600bb.jpg` gives a crisp tile on high-DPI screens.

**Files:**
- Create: `harvest/normalize.ts`, `harvest/fixtures/itunes-br-1122.json`, `harvest/fixtures/itunes-single-entry.json`
- Test: `tests/normalize.test.ts`

**Interfaces:**
- Consumes: `Song`, `GenreId` from `harvest/types.ts`
- Produces:
  - `type ItunesFeed` (structural type for the RSS JSON)
  - `normalizeItunes(raw: unknown, country: string, genre: GenreId): Song[]`
  - `upgradeArtwork(url: string): string`
  - `youtubeSearchUrl(artist: string, title: string): string`

- [ ] **Step 1: Create the fixtures**

`harvest/fixtures/itunes-br-1122.json` — two entries, mirroring the live response shape:
```json
{
  "feed": {
    "title": { "label": "iTunes Store: Top músicas em Brazilian" },
    "entry": [
      {
        "im:name": { "label": "Example Track One" },
        "im:image": [
          { "label": "https://is1-ssl.mzstatic.com/image/thumb/aaa/55x55bb.png" },
          { "label": "https://is1-ssl.mzstatic.com/image/thumb/aaa/60x60bb.png" },
          { "label": "https://is1-ssl.mzstatic.com/image/thumb/aaa/170x170bb.png" }
        ],
        "im:collection": { "im:name": { "label": "Example Album" } },
        "im:artist": { "label": "Example Artist" },
        "link": [
          { "attributes": { "rel": "alternate", "type": "text/html", "href": "https://music.apple.com/br/album/x/1" } },
          { "attributes": { "rel": "enclosure", "type": "audio/x-m4a", "href": "https://audio-ssl.itunes.apple.com/x/one.m4a" } }
        ],
        "id": { "attributes": { "im:id": "1000001" } },
        "category": { "attributes": { "im:id": "1225", "label": "MPB" } }
      },
      {
        "im:name": { "label": "Example Track Two" },
        "im:image": [
          { "label": "https://is1-ssl.mzstatic.com/image/thumb/bbb/170x170bb.png" }
        ],
        "im:collection": { "im:name": { "label": "Second Album" } },
        "im:artist": { "label": "Another Artist" },
        "link": [
          { "attributes": { "rel": "alternate", "type": "text/html", "href": "https://music.apple.com/br/album/y/2" } },
          { "attributes": { "rel": "enclosure", "type": "audio/x-m4a", "href": "https://audio-ssl.itunes.apple.com/y/two.m4a" } }
        ],
        "id": { "attributes": { "im:id": "1000002" } },
        "category": { "attributes": { "im:id": "1122", "label": "Brazilian" } }
      }
    ]
  }
}
```

`harvest/fixtures/itunes-single-entry.json` — the degraded-storefront shape, `entry` as a bare object:
```json
{
  "feed": {
    "title": { "label": "iTunes Store: Top Songs" },
    "entry": {
      "im:name": { "label": "Lonely Entry" },
      "im:image": [{ "label": "https://is1-ssl.mzstatic.com/image/thumb/ccc/170x170bb.png" }],
      "im:collection": { "im:name": { "label": "Solo Album" } },
      "im:artist": { "label": "Solo Artist" },
      "link": [
        { "attributes": { "rel": "alternate", "type": "text/html", "href": "https://music.apple.com/kr/album/z/3" } },
        { "attributes": { "rel": "enclosure", "type": "audio/x-m4a", "href": "https://audio-ssl.itunes.apple.com/z/three.m4a" } }
      ],
      "id": { "attributes": { "im:id": "1000003" } },
      "category": { "attributes": { "im:id": "14", "label": "Pop" } }
    }
  }
}
```

- [ ] **Step 2: Write the failing tests**

`tests/normalize.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { normalizeItunes, upgradeArtwork, youtubeSearchUrl } from '../harvest/normalize'
import multi from '../harvest/fixtures/itunes-br-1122.json'
import single from '../harvest/fixtures/itunes-single-entry.json'

describe('normalizeItunes', () => {
  it('maps a two-entry feed to two songs', () => {
    const songs = normalizeItunes(multi, 'br', 1122)
    expect(songs).toHaveLength(2)
    expect(songs[0]!.title).toBe('Example Track One')
    expect(songs[0]!.artist).toBe('Example Artist')
    expect(songs[0]!.album).toBe('Example Album')
  })

  it('stamps the requested country and genre, not the feed category', () => {
    // The first fixture entry self-reports category 1225 (MPB), but we asked for 1122.
    const songs = normalizeItunes(multi, 'br', 1122)
    expect(songs[0]!.genre).toBe(1122)
    expect(songs[0]!.country).toBe('br')
  })

  it('handles a single-entry feed returned as an object, not an array', () => {
    const songs = normalizeItunes(single, 'kr', 14)
    expect(songs).toHaveLength(1)
    expect(songs[0]!.title).toBe('Lonely Entry')
  })

  it('takes the preview URL from the enclosure link', () => {
    const songs = normalizeItunes(multi, 'br', 1122)
    expect(songs[0]!.preview).toBe('https://audio-ssl.itunes.apple.com/x/one.m4a')
    expect(songs[0]!.previewType).toBe('aac')
  })

  it('takes the store page from the alternate link', () => {
    const songs = normalizeItunes(multi, 'br', 1122)
    expect(songs[0]!.link).toBe('https://music.apple.com/br/album/x/1')
  })

  it('upgrades artwork to 600px', () => {
    const songs = normalizeItunes(multi, 'br', 1122)
    expect(songs[0]!.art).toContain('600x600')
  })

  it('builds a stable id from source and store id', () => {
    const a = normalizeItunes(multi, 'br', 1122)
    const b = normalizeItunes(multi, 'br', 1122)
    expect(a[0]!.id).toBe(b[0]!.id)
    expect(a[0]!.id).not.toBe(a[1]!.id)
  })

  it('builds a YouTube search link', () => {
    const songs = normalizeItunes(multi, 'br', 1122)
    expect(songs[0]!.yt).toBe(
      'https://www.youtube.com/results?search_query=Example%20Artist%20Example%20Track%20One',
    )
  })

  it('drops entries with no preview URL rather than emitting a silent tile', () => {
    const broken = {
      feed: {
        entry: [
          {
            'im:name': { label: 'No Preview' },
            'im:artist': { label: 'Nobody' },
            'im:image': [{ label: 'https://x/170x170bb.png' }],
            link: [{ attributes: { rel: 'alternate', type: 'text/html', href: 'https://x' } }],
            id: { attributes: { 'im:id': '9' } },
          },
        ],
      },
    }
    expect(normalizeItunes(broken, 'us', 14)).toHaveLength(0)
  })

  it('returns an empty array for a feed with no entries at all', () => {
    expect(normalizeItunes({ feed: {} }, 'us', 14)).toEqual([])
    expect(normalizeItunes(null, 'us', 14)).toEqual([])
  })
})

describe('upgradeArtwork', () => {
  it('rewrites the size segment', () => {
    expect(upgradeArtwork('https://x/thumb/aaa/170x170bb.png')).toBe(
      'https://x/thumb/aaa/600x600bb.jpg',
    )
  })

  it('leaves an unrecognised URL untouched', () => {
    expect(upgradeArtwork('https://x/cover.png')).toBe('https://x/cover.png')
  })
})

describe('youtubeSearchUrl', () => {
  it('encodes artist and title', () => {
    expect(youtubeSearchUrl('A & B', 'C/D')).toBe(
      'https://www.youtube.com/results?search_query=A%20%26%20B%20C%2FD',
    )
  })
})
```

- [ ] **Step 3: Run and watch it fail**

Run: `npx vitest run tests/normalize.test.ts`
Expected: FAIL — cannot resolve `../harvest/normalize`.

Add `"resolveJsonModule": true` to `tsconfig.json` `compilerOptions` so the fixtures import cleanly.

- [ ] **Step 4: Implement `harvest/normalize.ts`**

```ts
import { createHash } from 'node:crypto'
import type { GenreId, Song } from './types'

type Labelled = { label?: string } | undefined
type LinkAttrs = { rel?: string; type?: string; href?: string }

/** Apple returns `entry` as an object when the feed has exactly one item. */
function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function label(node: Labelled): string {
  return node?.label ?? ''
}

export function upgradeArtwork(url: string): string {
  return url.replace(/\/\d+x\d+bb\.(png|jpg)$/, '/600x600bb.jpg')
}

export function youtubeSearchUrl(artist: string, title: string): string {
  const q = encodeURIComponent(`${artist} ${title}`).replace(/%2520/g, '%20')
  return `https://www.youtube.com/results?search_query=${q}`
}

function stableId(source: string, storeId: string): string {
  return createHash('sha1').update(`${source}:${storeId}`).digest('hex').slice(0, 16)
}

export function normalizeItunes(raw: unknown, country: string, genre: GenreId): Song[] {
  const feed = (raw as { feed?: { entry?: unknown } } | null)?.feed
  const entries = asArray(feed?.entry as Record<string, unknown> | Record<string, unknown>[])

  const songs: Song[] = []

  for (const entry of entries) {
    const links = asArray(entry['link'] as { attributes?: LinkAttrs }[])
    const enclosure = links.find((l) => l.attributes?.rel === 'enclosure')
    const alternate = links.find((l) => l.attributes?.rel === 'alternate')

    const preview = enclosure?.attributes?.href
    if (!preview) continue // a tile with no audio is worse than no tile

    const images = asArray(entry['im:image'] as Labelled[])
    const largest = images[images.length - 1]
    const storeId = (entry['id'] as { attributes?: { 'im:id'?: string } } | undefined)
      ?.attributes?.['im:id']
    if (!storeId) continue

    const title = label(entry['im:name'] as Labelled)
    const artist = label(entry['im:artist'] as Labelled)
    const album = label(
      (entry['im:collection'] as { 'im:name'?: Labelled } | undefined)?.['im:name'],
    )

    songs.push({
      id: stableId('itunes', storeId),
      title,
      artist,
      ...(album ? { album } : {}),
      art: upgradeArtwork(label(largest)),
      preview,
      previewType: 'aac',
      // Always the genre we requested — never the entry's self-reported,
      // localized category.
      genre,
      country,
      source: 'itunes',
      link: alternate?.attributes?.href ?? '',
      yt: youtubeSearchUrl(artist, title),
    })
  }

  return songs
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/normalize.test.ts`
Expected: 13 passing.

- [ ] **Step 6: Commit**

```bash
git add harvest/normalize.ts harvest/fixtures tests/normalize.test.ts tsconfig.json
git commit -m "feat: normalize iTunes feed entries into Song records"
```

### Task 8: iTunes source with storefront health check and fallback

The `kr` storefront returns one entry for every genre — a storefront-level defect, not a genre one. This task detects that at the start of a run and routes affected storefronts to the marketing RSS feed instead.

`fetch` is injected so tests never hit the network.

**Files:**
- Create: `harvest/sources/itunes.ts`
- Test: `tests/itunes.test.ts`

**Interfaces:**
- Consumes: `TokenBucket`, `normalizeItunes`, `Song`, `GenreId`
- Produces:
  - `type Fetcher = (url: string) => Promise<unknown>`
  - `class ItunesSource` with `constructor(opts?: { fetcher?: Fetcher; bucket?: TokenBucket; limit?: number })`
  - `checkStorefront(country: string): Promise<boolean>` — `true` if genre feeds work
  - `fetchCell(country: string, genre: GenreId): Promise<Song[]>`
  - `topSongsUrl(country, genre, limit): string`, `marketingUrl(country, limit): string`

- [ ] **Step 1: Write the failing tests**

`tests/itunes.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { ItunesSource, topSongsUrl, marketingUrl } from '../harvest/sources/itunes'
import multi from '../harvest/fixtures/itunes-br-1122.json'
import single from '../harvest/fixtures/itunes-single-entry.json'

describe('URL builders', () => {
  it('builds the genre feed URL', () => {
    expect(topSongsUrl('br', 1122, 50)).toBe(
      'https://itunes.apple.com/br/rss/topsongs/limit=50/genre=1122/json',
    )
  })
  it('builds the marketing fallback URL', () => {
    expect(marketingUrl('kr', 50)).toBe(
      'https://rss.applemarketingtools.com/api/v2/kr/music/most-played/50/songs.json',
    )
  })
})

describe('checkStorefront', () => {
  it('accepts a storefront whose genre feed returns many entries', async () => {
    const src = new ItunesSource({ fetcher: async () => multi })
    expect(await src.checkStorefront('br')).toBe(true)
  })

  it('rejects a storefront whose genre feed returns a single entry', async () => {
    const src = new ItunesSource({ fetcher: async () => single })
    expect(await src.checkStorefront('kr')).toBe(false)
  })

  it('rejects a storefront that throws', async () => {
    const src = new ItunesSource({
      fetcher: async () => { throw new Error('502') },
    })
    expect(await src.checkStorefront('xx')).toBe(false)
  })

  it('caches the verdict so it is probed once per run', async () => {
    const fetcher = vi.fn(async () => multi)
    const src = new ItunesSource({ fetcher })
    await src.checkStorefront('br')
    await src.checkStorefront('br')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe('fetchCell', () => {
  it('returns normalized songs from the genre feed', async () => {
    const src = new ItunesSource({ fetcher: async () => multi })
    const songs = await src.fetchCell('br', 1122)
    expect(songs).toHaveLength(2)
    expect(songs[0]!.country).toBe('br')
    expect(songs[0]!.genre).toBe(1122)
  })

  it('falls back to the marketing feed for an unhealthy storefront', async () => {
    const seen: string[] = []
    const fetcher = vi.fn(async (url: string) => {
      seen.push(url)
      return url.includes('applemarketingtools') ? multi : single
    })
    const src = new ItunesSource({ fetcher })
    const songs = await src.fetchCell('kr', 14)

    expect(seen.some((u) => u.includes('applemarketingtools'))).toBe(true)
    expect(songs.length).toBeGreaterThan(0)
    // Fallback songs are still stamped with the cell we asked for.
    expect(songs[0]!.country).toBe('kr')
    expect(songs[0]!.genre).toBe(14)
  })

  it('returns an empty array instead of throwing when the feed fails', async () => {
    const src = new ItunesSource({
      fetcher: async (url) => {
        if (url.includes('genre=')) throw new Error('timeout')
        return { feed: {} }
      },
    })
    expect(await src.fetchCell('us', 14)).toEqual([])
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/itunes.test.ts`
Expected: FAIL — cannot resolve `../harvest/sources/itunes`.

- [ ] **Step 3: Implement `harvest/sources/itunes.ts`**

```ts
import { TokenBucket } from '../rateLimit'
import { normalizeItunes } from '../normalize'
import type { GenreId, Song } from '../types'

export type Fetcher = (url: string) => Promise<unknown>

/** A healthy storefront returns a full genre feed. One entry means it is degraded. */
const HEALTH_THRESHOLD = 5
const HEALTH_PROBE_GENRE: GenreId = 14 // Pop — present in every storefront

export function topSongsUrl(country: string, genre: GenreId, limit: number): string {
  return `https://itunes.apple.com/${country}/rss/topsongs/limit=${limit}/genre=${genre}/json`
}

export function marketingUrl(country: string, limit: number): string {
  return `https://rss.applemarketingtools.com/api/v2/${country}/music/most-played/${limit}/songs.json`
}

const defaultFetcher: Fetcher = async (url) => {
  const res = await fetch(url, { headers: { 'user-agent': 'listen-to-anything/1.0' } })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

export class ItunesSource {
  private readonly fetcher: Fetcher
  private readonly bucket: TokenBucket
  private readonly limit: number
  private readonly health = new Map<string, boolean>()

  constructor(opts: { fetcher?: Fetcher; bucket?: TokenBucket; limit?: number } = {}) {
    this.fetcher = opts.fetcher ?? defaultFetcher
    this.bucket = opts.bucket ?? new TokenBucket(8, 8)
    this.limit = opts.limit ?? 50
  }

  private async get(url: string): Promise<unknown> {
    await this.bucket.take()
    return this.fetcher(url)
  }

  /** True when genre-filtered feeds work for this storefront. Probed once per run. */
  async checkStorefront(country: string): Promise<boolean> {
    const cached = this.health.get(country)
    if (cached !== undefined) return cached

    let healthy = false
    try {
      const raw = await this.get(topSongsUrl(country, HEALTH_PROBE_GENRE, this.limit))
      healthy = normalizeItunes(raw, country, HEALTH_PROBE_GENRE).length >= HEALTH_THRESHOLD
    } catch {
      healthy = false
    }

    this.health.set(country, healthy)
    return healthy
  }

  async fetchCell(country: string, genre: GenreId): Promise<Song[]> {
    const healthy = await this.checkStorefront(country)

    if (healthy) {
      try {
        const raw = await this.get(topSongsUrl(country, genre, this.limit))
        return normalizeItunes(raw, country, genre)
      } catch {
        return []
      }
    }

    // Degraded storefront: the marketing feed is not genre-filterable, so every
    // genre in this country draws from the same national chart. Better a real
    // song in roughly the right place than an empty column.
    try {
      const raw = await this.get(marketingUrl(country, this.limit))
      return normalizeMarketing(raw, country, genre)
    } catch {
      return []
    }
  }
}

/** The marketing API has a different shape from the legacy RSS feed. */
function normalizeMarketing(raw: unknown, country: string, genre: GenreId): Song[] {
  const results = (raw as { feed?: { results?: unknown[] } } | null)?.feed?.results
  if (!Array.isArray(results)) {
    // The fallback may itself be served in legacy shape; try that before giving up.
    return normalizeItunes(raw, country, genre)
  }
  return normalizeItunes(
    {
      feed: {
        entry: results.map((r) => {
          const item = r as Record<string, string>
          return {
            'im:name': { label: item['name'] },
            'im:artist': { label: item['artistName'] },
            'im:image': [{ label: item['artworkUrl100'] }],
            id: { attributes: { 'im:id': item['id'] } },
            link: [
              { attributes: { rel: 'alternate', type: 'text/html', href: item['url'] } },
              { attributes: { rel: 'enclosure', type: 'audio/x-m4a', href: item['previewUrl'] } },
            ],
          }
        }),
      },
    },
    country,
    genre,
  )
}
```

> **Note for the implementer:** the marketing feed does not always include `previewUrl`. Entries without one are dropped by `normalizeItunes`, which is the desired behaviour — a silent tile is worse than a missing one. If a degraded storefront yields too few songs, the cell is flagged `thin` in Task 10 and the atlas continues to work.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/itunes.test.ts`
Expected: 9 passing.

- [ ] **Step 5: Commit**

```bash
git add harvest/sources/itunes.ts tests/itunes.test.ts
git commit -m "feat: add iTunes source with storefront health check and RSS fallback"
```

### Task 9: Deduplication across sources

**Files:**
- Create: `harvest/dedupe.ts`
- Test: `tests/dedupe.test.ts`

**Interfaces:**
- Consumes: `Song`, `SourceName`
- Produces: `dedupe(songs: Song[]): Song[]`, `matchKey(song: Song): string`

- [ ] **Step 1: Write the failing tests**

`tests/dedupe.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { dedupe, matchKey } from '../harvest/dedupe'
import type { Song } from '../harvest/types'

function song(over: Partial<Song>): Song {
  return {
    id: 'x', title: 'Title', artist: 'Artist', art: 'a', preview: 'p',
    previewType: 'aac', genre: 14, country: 'us', source: 'itunes',
    link: 'l', yt: 'y', ...over,
  }
}

describe('matchKey', () => {
  it('ignores case, punctuation and spacing', () => {
    expect(matchKey(song({ artist: 'The Band!', title: "Don't  Stop" })))
      .toBe(matchKey(song({ artist: 'the band', title: 'dont stop' })))
  })

  it('ignores common suffixes like (Remastered) and - Single Version', () => {
    expect(matchKey(song({ title: 'Song (Remastered 2011)' })))
      .toBe(matchKey(song({ title: 'Song' })))
    expect(matchKey(song({ title: 'Song - Single Version' })))
      .toBe(matchKey(song({ title: 'Song' })))
  })

  it('keeps genuinely different songs apart', () => {
    expect(matchKey(song({ title: 'A' }))).not.toBe(matchKey(song({ title: 'B' })))
  })
})

describe('dedupe', () => {
  it('removes a duplicate that arrived from a second source', () => {
    const out = dedupe([
      song({ id: '1', source: 'itunes' }),
      song({ id: '2', source: 'deezer' }),
    ])
    expect(out).toHaveLength(1)
  })

  it('prefers iTunes over Deezer over Jamendo', () => {
    expect(dedupe([song({ id: 'd', source: 'deezer' }), song({ id: 'i', source: 'itunes' })])[0]!.id)
      .toBe('i')
    expect(dedupe([song({ id: 'j', source: 'jamendo' }), song({ id: 'd', source: 'deezer' })])[0]!.id)
      .toBe('d')
  })

  it('preserves the order of the songs it keeps', () => {
    const out = dedupe([
      song({ id: '1', title: 'First' }),
      song({ id: '2', title: 'Second' }),
      song({ id: '3', title: 'Third' }),
    ])
    expect(out.map((s) => s.title)).toEqual(['First', 'Second', 'Third'])
  })

  it('handles an empty list', () => {
    expect(dedupe([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/dedupe.test.ts`
Expected: FAIL — cannot resolve `../harvest/dedupe`.

- [ ] **Step 3: Implement `harvest/dedupe.ts`**

```ts
import type { Song, SourceName } from './types'

/** Lower number wins when the same song arrives from two sources. */
const SOURCE_RANK: Record<SourceName, number> = { itunes: 0, deezer: 1, jamendo: 2 }

const NOISE = /\s*[([]?\s*(remaster(ed)?|single version|radio edit|deluxe|bonus track|live)\b[^)\]]*[)\]]?\s*$/i
const SUFFIX_DASH = /\s+-\s+.*$/

export function matchKey(song: Song): string {
  const clean = (s: string): string =>
    s
      .toLowerCase()
      .replace(NOISE, '')
      .replace(SUFFIX_DASH, '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '')

  return `${clean(song.artist)}|${clean(song.title)}`
}

export function dedupe(songs: Song[]): Song[] {
  const best = new Map<string, { song: Song; order: number }>()

  songs.forEach((song, order) => {
    const key = matchKey(song)
    const existing = best.get(key)
    if (!existing || SOURCE_RANK[song.source] < SOURCE_RANK[existing.song.source]) {
      best.set(key, { song, order: existing?.order ?? order })
    }
  })

  return [...best.values()].sort((a, b) => a.order - b.order).map((e) => e.song)
}
```

> The `- Single Version` case is handled by `SUFFIX_DASH`, which strips any trailing ` - ...`. This is deliberately aggressive: two tracks by the same artist whose titles differ only after a dash are almost always the same recording.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/dedupe.test.ts`
Expected: 8 passing.

- [ ] **Step 5: Commit**

```bash
git add harvest/dedupe.ts tests/dedupe.test.ts
git commit -m "feat: dedupe songs across sources with source preference"
```

### Task 10: Emitting shards and the manifest

**Files:**
- Create: `harvest/emit.ts`
- Test: `tests/emit.test.ts`

**Interfaces:**
- Consumes: `Song`, `Manifest`, `CellStats`, `SCHEMA_VERSION`, `cellKey`, `COUNTRIES`, `GENRES`, `SONGS_PER_CELL`
- Produces:
  - `const THIN_THRESHOLD = 5`
  - `writeCell(dir: string, key: string, songs: Song[]): Promise<CellStats>`
  - `buildManifest(cells: Record<string, CellStats>, countries: readonly string[], genres: readonly { id: GenreId; label: string }[]): Manifest`
  - `writeManifest(dir: string, manifest: Manifest): Promise<void>`
  - `readExistingCell(dir: string, key: string): Promise<Song[] | null>`

- [ ] **Step 1: Write the failing tests**

`tests/emit.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeCell, buildManifest, writeManifest, readExistingCell, THIN_THRESHOLD } from '../harvest/emit'
import { SCHEMA_VERSION } from '../harvest/types'
import type { Song } from '../harvest/types'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'lta-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

function songs(n: number): Song[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `id${i}`, title: `T${i}`, artist: `A${i}`, art: 'art', preview: 'prev',
    previewType: 'aac' as const, genre: 14, country: 'us',
    source: 'itunes' as const, link: 'l', yt: 'y',
  }))
}

describe('writeCell', () => {
  it('writes a JSON array and reports the count', async () => {
    const stats = await writeCell(dir, 'us-14', songs(50))
    expect(stats).toEqual({ count: 50 })
    const parsed = JSON.parse(await readFile(join(dir, 'cells', 'us-14.json'), 'utf8'))
    expect(parsed).toHaveLength(50)
    expect(parsed[0].title).toBe('T0')
  })

  it('truncates to at most SONGS_PER_CELL', async () => {
    const stats = await writeCell(dir, 'us-14', songs(80))
    expect(stats.count).toBe(50)
  })

  it('flags a thin cell', async () => {
    const stats = await writeCell(dir, 'us-14', songs(THIN_THRESHOLD - 1))
    expect(stats.thin).toBe(true)
  })

  it('does not flag a healthy cell', async () => {
    const stats = await writeCell(dir, 'us-14', songs(THIN_THRESHOLD))
    expect(stats.thin).toBeUndefined()
  })
})

describe('readExistingCell', () => {
  it('reads back what writeCell wrote', async () => {
    await writeCell(dir, 'us-14', songs(3))
    const back = await readExistingCell(dir, 'us-14')
    expect(back).toHaveLength(3)
  })

  it('returns null for a cell that was never written', async () => {
    expect(await readExistingCell(dir, 'zz-99')).toBeNull()
  })
})

describe('buildManifest', () => {
  it('stamps schema version and an ISO timestamp', () => {
    const m = buildManifest({ 'us-14': { count: 50 } }, ['us'], [{ id: 14, label: 'Pop' }])
    expect(m.schemaVersion).toBe(SCHEMA_VERSION)
    expect(() => new Date(m.harvestedAt).toISOString()).not.toThrow()
  })

  it('carries the axis order through unchanged', () => {
    const m = buildManifest({}, ['us', 'br'], [{ id: 14, label: 'Pop' }, { id: 21, label: 'Rock' }])
    expect(m.countries).toEqual(['us', 'br'])
    expect(m.genres.map((g) => g.id)).toEqual([14, 21])
  })
})

describe('writeManifest', () => {
  it('writes manifest.json at the root of the data dir', async () => {
    const m = buildManifest({ 'us-14': { count: 50 } }, ['us'], [{ id: 14, label: 'Pop' }])
    await writeManifest(dir, m)
    const parsed = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))
    expect(parsed.cells['us-14'].count).toBe(50)
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/emit.test.ts`
Expected: FAIL — cannot resolve `../harvest/emit`.

- [ ] **Step 3: Implement `harvest/emit.ts`**

```ts
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  SCHEMA_VERSION, SONGS_PER_CELL,
  type CellStats, type GenreId, type Manifest, type Song,
} from './types'

/** Fewer songs than this and the cell is flagged, but still shipped. */
export const THIN_THRESHOLD = 5

export async function writeCell(dir: string, key: string, songs: Song[]): Promise<CellStats> {
  const capped = songs.slice(0, SONGS_PER_CELL)
  const cellsDir = join(dir, 'cells')
  await mkdir(cellsDir, { recursive: true })
  await writeFile(join(cellsDir, `${key}.json`), JSON.stringify(capped), 'utf8')

  const stats: CellStats = { count: capped.length }
  if (capped.length < THIN_THRESHOLD) stats.thin = true
  return stats
}

/** Used by the resumable runner to skip cells already harvested. */
export async function readExistingCell(dir: string, key: string): Promise<Song[] | null> {
  try {
    const text = await readFile(join(dir, 'cells', `${key}.json`), 'utf8')
    return JSON.parse(text) as Song[]
  } catch {
    return null
  }
}

export function buildManifest(
  cells: Record<string, CellStats>,
  countries: readonly string[],
  genres: readonly { id: GenreId; label: string }[],
): Manifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    harvestedAt: new Date().toISOString(),
    countries: [...countries],
    genres: genres.map((g) => ({ id: g.id, label: g.label })),
    cells,
  }
}

export async function writeManifest(dir: string, manifest: Manifest): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf8')
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/emit.test.ts`
Expected: 10 passing.

- [ ] **Step 5: Commit**

```bash
git add harvest/emit.ts tests/emit.test.ts
git commit -m "feat: write sharded cell files and the manifest"
```

### Task 11: The resumable harvest runner

Writes each cell as it completes, so a crash at cell 700 of 1,200 loses nothing. Re-running skips cells already on disk unless `--force` is passed.

**Files:**
- Create: `harvest/run.ts`
- Test: `tests/run.test.ts`

**Interfaces:**
- Consumes: `ItunesSource`, `dedupe`, `writeCell`, `readExistingCell`, `buildManifest`, `writeManifest`, `COUNTRIES`, `GENRES`, `cellKey`
- Produces: `harvestAll(opts: HarvestOptions): Promise<Manifest>` and a CLI entrypoint
  - `type HarvestOptions = { dir: string; countries?: readonly string[]; genres?: readonly {id: GenreId; label: string}[]; source?: { fetchCell(c: string, g: GenreId): Promise<Song[]> }; force?: boolean; onProgress?: (done: number, total: number, key: string) => void }`

- [ ] **Step 1: Write the failing tests**

`tests/run.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { harvestAll } from '../harvest/run'
import { readExistingCell } from '../harvest/emit'
import type { GenreId, Song } from '../harvest/types'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'lta-run-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const countries = ['us', 'br'] as const
const genres = [{ id: 14, label: 'Pop' }, { id: 21, label: 'Rock' }] as const

function fakeSource(perCell = 10) {
  return {
    fetchCell: vi.fn(async (country: string, genre: GenreId): Promise<Song[]> =>
      Array.from({ length: perCell }, (_, i) => ({
        id: `${country}-${genre}-${i}`, title: `T${i}`, artist: `A${i}`,
        art: 'art', preview: 'prev', previewType: 'aac' as const,
        genre, country, source: 'itunes' as const, link: 'l', yt: 'y',
      })),
    ),
  }
}

describe('harvestAll', () => {
  it('visits every country x genre cell exactly once', async () => {
    const source = fakeSource()
    await harvestAll({ dir, countries, genres, source })
    expect(source.fetchCell).toHaveBeenCalledTimes(4)
  })

  it('writes one file per cell', async () => {
    await harvestAll({ dir, countries, genres, source: fakeSource() })
    for (const c of countries) {
      for (const g of genres) {
        expect(await readExistingCell(dir, `${c}-${g.id}`)).toHaveLength(10)
      }
    }
  })

  it('returns a manifest describing every cell', async () => {
    const m = await harvestAll({ dir, countries, genres, source: fakeSource() })
    expect(Object.keys(m.cells).sort()).toEqual(['br-14', 'br-21', 'us-14', 'us-21'])
    expect(m.cells['us-14']!.count).toBe(10)
  })

  it('omits a cell that yielded nothing, so the atlas can close the gap', async () => {
    const source = {
      fetchCell: async (c: string, g: GenreId): Promise<Song[]> =>
        c === 'br' && g === 21 ? [] : [{
          id: 'x', title: 'T', artist: 'A', art: 'a', preview: 'p',
          previewType: 'aac' as const, genre: g, country: c,
          source: 'itunes' as const, link: 'l', yt: 'y',
        }],
    }
    const m = await harvestAll({ dir, countries, genres, source })
    expect(m.cells['br-21']).toBeUndefined()
    expect(m.cells['us-14']).toBeDefined()
  })

  it('is resumable: a second run skips cells already on disk', async () => {
    const first = fakeSource()
    await harvestAll({ dir, countries, genres, source: first })

    const second = fakeSource()
    await harvestAll({ dir, countries, genres, source: second })
    expect(second.fetchCell).not.toHaveBeenCalled()
  })

  it('re-fetches everything when force is set', async () => {
    await harvestAll({ dir, countries, genres, source: fakeSource() })
    const forced = fakeSource()
    await harvestAll({ dir, countries, genres, source: forced, force: true })
    expect(forced.fetchCell).toHaveBeenCalledTimes(4)
  })

  it('keeps going when one cell throws', async () => {
    const source = {
      fetchCell: async (c: string, g: GenreId): Promise<Song[]> => {
        if (c === 'us' && g === 14) throw new Error('upstream exploded')
        return [{
          id: 'x', title: 'T', artist: 'A', art: 'a', preview: 'p',
          previewType: 'aac' as const, genre: g, country: c,
          source: 'itunes' as const, link: 'l', yt: 'y',
        }]
      },
    }
    const m = await harvestAll({ dir, countries, genres, source })
    expect(m.cells['us-14']).toBeUndefined()
    expect(Object.keys(m.cells)).toHaveLength(3)
  })

  it('reports progress', async () => {
    const seen: string[] = []
    await harvestAll({
      dir, countries, genres, source: fakeSource(),
      onProgress: (_d, _t, key) => seen.push(key),
    })
    expect(seen).toHaveLength(4)
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/run.test.ts`
Expected: FAIL — cannot resolve `../harvest/run`.

- [ ] **Step 3: Implement `harvest/run.ts`**

```ts
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { COUNTRIES, GENRES } from './taxonomy'
import { ItunesSource } from './sources/itunes'
import { dedupe } from './dedupe'
import { buildManifest, readExistingCell, writeCell, writeManifest } from './emit'
import { cellKey, type CellStats, type GenreId, type Manifest, type Song } from './types'

export type SourceLike = { fetchCell(country: string, genre: GenreId): Promise<Song[]> }

export type HarvestOptions = {
  dir: string
  countries?: readonly string[]
  genres?: readonly { id: GenreId; label: string }[]
  source?: SourceLike
  force?: boolean
  onProgress?: (done: number, total: number, key: string) => void
}

export async function harvestAll(opts: HarvestOptions): Promise<Manifest> {
  const countries = opts.countries ?? COUNTRIES
  const genres = opts.genres ?? GENRES
  const source = opts.source ?? new ItunesSource()
  const cells: Record<string, CellStats> = {}

  const total = countries.length * genres.length
  let done = 0

  for (const country of countries) {
    for (const genre of genres) {
      const key = cellKey(country, genre.id)

      if (!opts.force) {
        const existing = await readExistingCell(opts.dir, key)
        if (existing !== null) {
          if (existing.length > 0) cells[key] = await writeCell(opts.dir, key, existing)
          opts.onProgress?.(++done, total, key)
          continue
        }
      }

      let songs: Song[] = []
      try {
        songs = dedupe(await source.fetchCell(country, genre.id))
      } catch (err) {
        console.warn(`[harvest] ${key} failed: ${(err as Error).message}`)
        songs = []
      }

      // An empty cell is omitted from the manifest entirely; the atlas
      // closes the gap rather than rendering a hole.
      if (songs.length > 0) cells[key] = await writeCell(opts.dir, key, songs)

      opts.onProgress?.(++done, total, key)
    }
  }

  const manifest = buildManifest(cells, countries, genres)
  await writeManifest(opts.dir, manifest)
  return manifest
}

// CLI entrypoint: npm run harvest -- [--force]
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = join(process.cwd(), 'public', 'data')
  const force = process.argv.includes('--force')

  harvestAll({
    dir,
    force,
    onProgress: (d, t, key) => {
      if (d % 25 === 0 || d === t) console.log(`[harvest] ${d}/${t} (${key})`)
    },
  })
    .then((m) => {
      const thin = Object.values(m.cells).filter((c) => c.thin).length
      console.log(`[harvest] done: ${Object.keys(m.cells).length} cells, ${thin} thin`)
    })
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/run.test.ts`
Expected: 8 passing.

- [ ] **Step 5: Do a real partial harvest to prove it works end to end**

```bash
npx tsx -e "import('./harvest/run.ts').then(m => m.harvestAll({ dir: 'public/data', countries: ['us','br'], genres: [{id:14,label:'Pop'},{id:1122,label:'Brazilian'}], onProgress: (d,t,k) => console.log(d,t,k) }))"
```

Expected: 4 files in `public/data/cells/`, plus `manifest.json`. Open one and confirm real titles, artwork URLs, and `audio-ssl.itunes.apple.com` preview URLs. Paste a preview URL into a browser and confirm it plays.

- [ ] **Step 6: Run the full suite and commit**

Run: `npm test`

```bash
git add harvest/run.ts tests/run.test.ts
git commit -m "feat: add resumable harvest runner with per-cell fault isolation"
```

**Milestone 2 complete.** The harvest can fill `public/data/` unattended and survive upstream failures. Run the full harvest now — `npm run harvest` — while building Milestone 3; it takes roughly 20–40 minutes for all 1,200 cells.

---

## Milestone 3 — Render and play

### Task 12: Cell store and manifest loader

**Files:**
- Create: `src/data/loader.ts`
- Test: `tests/loader.test.ts`

**Interfaces:**
- Consumes: `Manifest`, `Song`, `SCHEMA_VERSION` from `src/types.ts`
- Produces:
  - `loadManifest(fetcher?: typeof fetch, base?: string): Promise<Manifest>`
  - `class CellStore` with `constructor(opts?: { fetcher?: typeof fetch; base?: string; retries?: number })`, `get(key): Song[] | undefined`, `status(key): 'missing' | 'loading' | 'ready' | 'failed'`, `ensure(keys: string[]): void`, `onChange(cb: () => void): () => void`

- [ ] **Step 1: Write the failing tests**

`tests/loader.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { CellStore, loadManifest } from '../src/data/loader'
import { SCHEMA_VERSION } from '../src/types'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response
}

const manifest = {
  schemaVersion: SCHEMA_VERSION,
  harvestedAt: '2026-08-03T00:00:00.000Z',
  countries: ['us'],
  genres: [{ id: 14, label: 'Pop' }],
  cells: { 'us-14': { count: 2 } },
}

const twoSongs = [
  { id: 'a', title: 'A', artist: 'X', art: 'art', preview: 'p', previewType: 'aac', genre: 14, country: 'us', source: 'itunes', link: 'l', yt: 'y' },
  { id: 'b', title: 'B', artist: 'Y', art: 'art', preview: 'p', previewType: 'aac', genre: 14, country: 'us', source: 'itunes', link: 'l', yt: 'y' },
]

describe('loadManifest', () => {
  it('fetches manifest.json from the data base path', async () => {
    const fetcher = vi.fn(async () => jsonResponse(manifest)) as unknown as typeof fetch
    const m = await loadManifest(fetcher)
    expect(m.countries).toEqual(['us'])
    expect(fetcher).toHaveBeenCalledWith('/data/manifest.json')
  })

  it('refuses a manifest from a future schema', async () => {
    const bad = { ...manifest, schemaVersion: SCHEMA_VERSION + 1 }
    const fetcher = (async () => jsonResponse(bad)) as unknown as typeof fetch
    await expect(loadManifest(fetcher)).rejects.toThrow(/schema/i)
  })

  it('throws on a non-ok response', async () => {
    const fetcher = (async () => jsonResponse(null, false, 404)) as unknown as typeof fetch
    await expect(loadManifest(fetcher)).rejects.toThrow()
  })
})

describe('CellStore', () => {
  it('reports missing before anything is requested', () => {
    const store = new CellStore({ fetcher: (async () => jsonResponse([])) as unknown as typeof fetch })
    expect(store.status('us-14')).toBe('missing')
    expect(store.get('us-14')).toBeUndefined()
  })

  it('loads a requested cell and notifies subscribers', async () => {
    const fetcher = (async () => jsonResponse(twoSongs)) as unknown as typeof fetch
    const store = new CellStore({ fetcher })
    const onChange = vi.fn()
    store.onChange(onChange)

    store.ensure(['us-14'])
    expect(store.status('us-14')).toBe('loading')

    await vi.waitFor(() => expect(store.status('us-14')).toBe('ready'))
    expect(store.get('us-14')).toHaveLength(2)
    expect(onChange).toHaveBeenCalled()
  })

  it('requests each cell only once', async () => {
    const fetcher = vi.fn(async () => jsonResponse(twoSongs)) as unknown as typeof fetch
    const store = new CellStore({ fetcher })
    store.ensure(['us-14'])
    store.ensure(['us-14'])
    await vi.waitFor(() => expect(store.status('us-14')).toBe('ready'))
    store.ensure(['us-14'])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('retries once then marks the cell failed', async () => {
    const fetcher = vi.fn(async () => jsonResponse(null, false, 500)) as unknown as typeof fetch
    const store = new CellStore({ fetcher, retries: 1 })
    store.ensure(['us-14'])
    await vi.waitFor(() => expect(store.status('us-14')).toBe('failed'))
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('evicts cells that are no longer required', async () => {
    const fetcher = (async () => jsonResponse(twoSongs)) as unknown as typeof fetch
    const store = new CellStore({ fetcher })
    store.ensure(['us-14'])
    await vi.waitFor(() => expect(store.status('us-14')).toBe('ready'))

    store.ensure(['br-21'])
    expect(store.status('us-14')).toBe('missing')
  })

  it('stops notifying after unsubscribe', async () => {
    const fetcher = (async () => jsonResponse(twoSongs)) as unknown as typeof fetch
    const store = new CellStore({ fetcher })
    const onChange = vi.fn()
    const off = store.onChange(onChange)
    off()
    store.ensure(['us-14'])
    await vi.waitFor(() => expect(store.status('us-14')).toBe('ready'))
    expect(onChange).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/loader.test.ts`
Expected: FAIL — cannot resolve `../src/data/loader`.

- [ ] **Step 3: Implement `src/data/loader.ts`**

```ts
import { SCHEMA_VERSION, type Manifest, type Song } from '../types'

const DEFAULT_BASE = '/data'

export async function loadManifest(
  fetcher: typeof fetch = fetch,
  base: string = DEFAULT_BASE,
): Promise<Manifest> {
  const res = await fetcher(`${base}/manifest.json`)
  if (!res.ok) throw new Error(`manifest fetch failed: ${res.status}`)

  const manifest = (await res.json()) as Manifest
  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `manifest schema ${manifest.schemaVersion} does not match app schema ${SCHEMA_VERSION} — re-run the harvest`,
    )
  }
  return manifest
}

type CellState =
  | { status: 'loading' }
  | { status: 'ready'; songs: Song[] }
  | { status: 'failed' }

export class CellStore {
  private readonly cells = new Map<string, CellState>()
  private readonly listeners = new Set<() => void>()
  private readonly fetcher: typeof fetch
  private readonly base: string
  private readonly retries: number

  constructor(opts: { fetcher?: typeof fetch; base?: string; retries?: number } = {}) {
    this.fetcher = opts.fetcher ?? fetch
    this.base = opts.base ?? DEFAULT_BASE
    this.retries = opts.retries ?? 1
  }

  get(key: string): Song[] | undefined {
    const state = this.cells.get(key)
    return state?.status === 'ready' ? state.songs : undefined
  }

  status(key: string): 'missing' | 'loading' | 'ready' | 'failed' {
    return this.cells.get(key)?.status ?? 'missing'
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** Load anything in `keys` that is not loaded; drop anything not in `keys`. */
  ensure(keys: string[]): void {
    const wanted = new Set(keys)

    for (const key of [...this.cells.keys()]) {
      if (!wanted.has(key)) this.cells.delete(key)
    }

    for (const key of wanted) {
      if (this.cells.has(key)) continue
      this.cells.set(key, { status: 'loading' })
      void this.load(key)
    }
  }

  private async load(key: string): Promise<void> {
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await this.fetcher(`${this.base}/cells/${key}.json`)
        if (!res.ok) throw new Error(String(res.status))
        const songs = (await res.json()) as Song[]

        // The cell may have been evicted while in flight.
        if (!this.cells.has(key)) return
        this.cells.set(key, { status: 'ready', songs })
        this.emit()
        return
      } catch {
        if (attempt === this.retries) {
          if (!this.cells.has(key)) return
          this.cells.set(key, { status: 'failed' })
          this.emit()
        }
      }
    }
  }

  private emit(): void {
    for (const cb of this.listeners) cb()
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/loader.test.ts`
Expected: 10 passing.

- [ ] **Step 5: Commit**

```bash
git add src/data/loader.ts tests/loader.test.ts
git commit -m "feat: add cell store with lazy loading, retry, and eviction"
```

### Task 13: Image cache with gradient fallback

**Files:**
- Create: `src/render/imageCache.ts`
- Test: `tests/imageCache.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `const IMAGE_CACHE_CAPACITY = 600`
  - `class ImageCache` with `constructor(opts?: { capacity?: number; make?: () => HTMLImageElement })`, `get(url: string): HTMLImageElement | null`, `onLoad(cb: () => void): () => void`, `readonly size: number`
  - `fallbackColors(id: string): [string, string]`

- [ ] **Step 1: Write the failing tests**

`tests/imageCache.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { ImageCache, fallbackColors } from '../src/render/imageCache'

/** A stand-in for HTMLImageElement that we can resolve on demand. */
function fakeImageFactory() {
  const created: any[] = []
  const make = () => {
    const img: any = { src: '', complete: false, naturalWidth: 0 }
    img.decode = vi.fn(async () => { img.complete = true; img.naturalWidth = 600 })
    created.push(img)
    return img as HTMLImageElement
  }
  return { make, created }
}

describe('ImageCache', () => {
  it('returns null on first request and starts a load', () => {
    const { make, created } = fakeImageFactory()
    const cache = new ImageCache({ make })
    expect(cache.get('https://x/a.jpg')).toBeNull()
    expect(created).toHaveLength(1)
    expect(created[0].src).toBe('https://x/a.jpg')
  })

  it('returns the image once decoded, and notifies', async () => {
    const { make } = fakeImageFactory()
    const cache = new ImageCache({ make })
    const onLoad = vi.fn()
    cache.onLoad(onLoad)

    cache.get('https://x/a.jpg')
    await vi.waitFor(() => expect(cache.get('https://x/a.jpg')).not.toBeNull())
    expect(onLoad).toHaveBeenCalled()
  })

  it('only creates one element per URL', () => {
    const { make, created } = fakeImageFactory()
    const cache = new ImageCache({ make })
    cache.get('https://x/a.jpg')
    cache.get('https://x/a.jpg')
    expect(created).toHaveLength(1)
  })

  it('evicts least-recently-used entries past capacity', async () => {
    const { make } = fakeImageFactory()
    const cache = new ImageCache({ capacity: 2, make })
    cache.get('a'); cache.get('b')
    await vi.waitFor(() => expect(cache.get('a')).not.toBeNull())

    cache.get('a')      // touch 'a' so 'b' becomes least-recent
    cache.get('c')      // pushes past capacity
    expect(cache.size).toBe(2)
  })

  it('marks a failed image as failed rather than retrying forever', async () => {
    const make = () => {
      const img: any = { src: '', complete: false }
      img.decode = vi.fn(async () => { throw new Error('404') })
      return img as HTMLImageElement
    }
    const cache = new ImageCache({ make })
    cache.get('bad')
    await vi.waitFor(() => expect(cache.size).toBe(1))
    expect(cache.get('bad')).toBeNull()
  })
})

describe('fallbackColors', () => {
  it('is deterministic for the same id', () => {
    expect(fallbackColors('abc')).toEqual(fallbackColors('abc'))
  })

  it('differs between ids', () => {
    expect(fallbackColors('abc')).not.toEqual(fallbackColors('xyz'))
  })

  it('returns two CSS hsl colours', () => {
    const [a, b] = fallbackColors('abc')
    expect(a).toMatch(/^hsl\(/)
    expect(b).toMatch(/^hsl\(/)
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/imageCache.test.ts`
Expected: FAIL — cannot resolve `../src/render/imageCache`.

- [ ] **Step 3: Implement `src/render/imageCache.ts`**

```ts
export const IMAGE_CACHE_CAPACITY = 600

type Entry =
  | { status: 'loading'; img: HTMLImageElement }
  | { status: 'ready'; img: HTMLImageElement }
  | { status: 'failed' }

export class ImageCache {
  /** Map iteration order is insertion order, which gives us LRU for free. */
  private readonly entries = new Map<string, Entry>()
  private readonly listeners = new Set<() => void>()
  private readonly capacity: number
  private readonly make: () => HTMLImageElement

  constructor(opts: { capacity?: number; make?: () => HTMLImageElement } = {}) {
    this.capacity = opts.capacity ?? IMAGE_CACHE_CAPACITY
    this.make = opts.make ?? (() => new Image())
  }

  get size(): number {
    return this.entries.size
  }

  onLoad(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** Returns the decoded image, or null while loading / after failure. */
  get(url: string): HTMLImageElement | null {
    const existing = this.entries.get(url)

    if (existing) {
      // Touch for LRU.
      this.entries.delete(url)
      this.entries.set(url, existing)
      return existing.status === 'ready' ? existing.img : null
    }

    const img = this.make()
    img.crossOrigin = 'anonymous'
    img.src = url
    this.entries.set(url, { status: 'loading', img })
    this.evict()

    void img
      .decode()
      .then(() => {
        if (this.entries.has(url)) this.entries.set(url, { status: 'ready', img })
        this.emit()
      })
      .catch(() => {
        if (this.entries.has(url)) this.entries.set(url, { status: 'failed' })
        this.emit()
      })

    return null
  }

  private evict(): void {
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next()
      if (oldest.done) return
      this.entries.delete(oldest.value)
    }
  }

  private emit(): void {
    for (const cb of this.listeners) cb()
  }
}

/** Deterministic two-tone gradient so a missing cover never shows a broken box. */
export function fallbackColors(id: string): [string, string] {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0

  const hue = Math.abs(hash) % 360
  return [`hsl(${hue}, 45%, 32%)`, `hsl(${(hue + 40) % 360}, 40%, 12%)`]
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/imageCache.test.ts`
Expected: 8 passing.

- [ ] **Step 5: Commit**

```bash
git add src/render/imageCache.ts tests/imageCache.test.ts
git commit -m "feat: add LRU image cache with deterministic gradient fallback"
```

### Task 14: Audio engine

Two `<audio>` elements crossfading, and a hover debounce so the cursor must *settle* on a tile rather than sweep past it. The element factory is injected so tests run with no real playback.

**Files:**
- Create: `src/audio/engine.ts`
- Test: `tests/audioEngine.test.ts`

**Interfaces:**
- Consumes: `Song` from `src/types.ts`
- Produces:
  - `const HOVER_DEBOUNCE_MS = 180`, `const CROSSFADE_MS = 250`
  - `type AudioLike` — the subset of `HTMLAudioElement` the engine uses
  - `class AudioEngine` with `constructor(opts?: { debounceMs?; fadeMs?; make?: () => AudioLike })`, `hover(song: Song | null): void`, `pin(song: Song): void`, `unpin(): void`, `get pinned(): Song | null`, `get playing(): Song | null`, `setVolume(v: number): void`, `setMuted(m: boolean): void`, `onChange(cb: () => void): () => void`, `dispose(): void`

- [ ] **Step 1: Write the failing tests**

`tests/audioEngine.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AudioEngine, HOVER_DEBOUNCE_MS, type AudioLike } from '../src/audio/engine'
import type { Song } from '../src/types'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function song(id: string): Song {
  return {
    id, title: `T${id}`, artist: `A${id}`, art: 'art', preview: `https://cdn/${id}.m4a`,
    previewType: 'aac', genre: 14, country: 'us', source: 'itunes', link: 'l', yt: 'y',
  }
}

function fakeAudioFactory() {
  const made: AudioLike[] = []
  const make = (): AudioLike => {
    const el = {
      src: '', volume: 1, muted: false, currentTime: 0,
      play: vi.fn(async () => {}),
      pause: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as AudioLike
    made.push(el)
    return el
  }
  return { make, made }
}

describe('AudioEngine hover debounce', () => {
  it('does not play until the cursor settles', () => {
    const { make, made } = fakeAudioFactory()
    const engine = new AudioEngine({ make })

    engine.hover(song('a'))
    expect(made.every((el) => (el.play as any).mock.calls.length === 0)).toBe(true)

    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS)
    expect(made.some((el) => (el.play as any).mock.calls.length === 1)).toBe(true)
  })

  it('a hover storm produces exactly one play', () => {
    const { make, made } = fakeAudioFactory()
    const engine = new AudioEngine({ make })

    for (let i = 0; i < 40; i++) {
      engine.hover(song(`s${i}`))
      vi.advanceTimersByTime(10) // well under the debounce
    }
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS)

    const plays = made.reduce((n, el) => n + (el.play as any).mock.calls.length, 0)
    expect(plays).toBe(1)
  })

  it('plays the last song hovered, not the first', () => {
    const { make, made } = fakeAudioFactory()
    const engine = new AudioEngine({ make })

    engine.hover(song('first'))
    vi.advanceTimersByTime(50)
    engine.hover(song('last'))
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS)

    expect(engine.playing?.id).toBe('last')
    expect(made.some((el) => el.src.includes('last'))).toBe(true)
  })

  it('hovering nothing cancels a pending play', () => {
    const { make, made } = fakeAudioFactory()
    const engine = new AudioEngine({ make })

    engine.hover(song('a'))
    engine.hover(null)
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS * 2)

    const plays = made.reduce((n, el) => n + (el.play as any).mock.calls.length, 0)
    expect(plays).toBe(0)
  })

  it('re-hovering the song already playing does not restart it', () => {
    const { make, made } = fakeAudioFactory()
    const engine = new AudioEngine({ make })

    engine.hover(song('a'))
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS)
    engine.hover(song('a'))
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS)

    const plays = made.reduce((n, el) => n + (el.play as any).mock.calls.length, 0)
    expect(plays).toBe(1)
  })
})

describe('AudioEngine crossfade', () => {
  it('alternates between two elements and never creates more', () => {
    const { make, made } = fakeAudioFactory()
    const engine = new AudioEngine({ make })

    engine.hover(song('a'))
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS + 400)
    engine.hover(song('b'))
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS + 400)
    engine.hover(song('c'))
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS + 400)

    expect(made).toHaveLength(2)
  })

  it('ramps the outgoing element down and pauses it', () => {
    const { make, made } = fakeAudioFactory()
    const engine = new AudioEngine({ make, fadeMs: 100 })

    engine.hover(song('a'))
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS)
    const first = made.find((el) => el.src.includes('a'))!

    engine.hover(song('b'))
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS + 200)

    expect((first.pause as any).mock.calls.length).toBeGreaterThan(0)
  })
})

describe('AudioEngine pinning', () => {
  it('pinning keeps a song playing while hovering elsewhere', () => {
    const { make } = fakeAudioFactory()
    const engine = new AudioEngine({ make })

    engine.pin(song('pinned'))
    engine.hover(song('other'))
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS * 3)

    expect(engine.pinned?.id).toBe('pinned')
    expect(engine.playing?.id).toBe('pinned')
  })

  it('unpinning lets hover take over again', () => {
    const { make } = fakeAudioFactory()
    const engine = new AudioEngine({ make })

    engine.pin(song('pinned'))
    engine.unpin()
    engine.hover(song('other'))
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS)

    expect(engine.pinned).toBeNull()
    expect(engine.playing?.id).toBe('other')
  })
})

describe('AudioEngine volume', () => {
  it('applies volume to both elements', () => {
    const { make, made } = fakeAudioFactory()
    const engine = new AudioEngine({ make })
    engine.setVolume(0.4)
    expect(made.length).toBeGreaterThan(0)
    for (const el of made) expect(el.volume).toBeLessThanOrEqual(0.4)
  })

  it('clamps volume into 0..1', () => {
    const { make, made } = fakeAudioFactory()
    const engine = new AudioEngine({ make })
    engine.setVolume(5)
    for (const el of made) expect(el.volume).toBeLessThanOrEqual(1)
  })

  it('mutes both elements', () => {
    const { make, made } = fakeAudioFactory()
    const engine = new AudioEngine({ make })
    engine.setMuted(true)
    for (const el of made) expect(el.muted).toBe(true)
  })
})

describe('AudioEngine notifications', () => {
  it('notifies subscribers when the playing song changes', () => {
    const { make } = fakeAudioFactory()
    const engine = new AudioEngine({ make })
    const cb = vi.fn()
    engine.onChange(cb)

    engine.hover(song('a'))
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS)
    expect(cb).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/audioEngine.test.ts`
Expected: FAIL — cannot resolve `../src/audio/engine`.

- [ ] **Step 3: Implement `src/audio/engine.ts`**

```ts
import type { Song } from '../types'

/** The cursor must settle for this long before a preview starts. */
export const HOVER_DEBOUNCE_MS = 180
export const CROSSFADE_MS = 250

const FADE_STEPS = 10

/** Only the parts of HTMLAudioElement we use — keeps tests trivial to fake. */
export type AudioLike = {
  src: string
  volume: number
  muted: boolean
  currentTime: number
  play(): Promise<void>
  pause(): void
  addEventListener(type: string, cb: () => void): void
  removeEventListener(type: string, cb: () => void): void
}

type Deck = { el: AudioLike; song: Song | null }

export class AudioEngine {
  private readonly decks: [Deck, Deck]
  private active = 0
  private readonly debounceMs: number
  private readonly fadeMs: number

  private hoverTimer: ReturnType<typeof setTimeout> | null = null
  private fadeTimer: ReturnType<typeof setInterval> | null = null
  private pendingSong: Song | null = null
  private pinnedSong: Song | null = null
  private volume = 1
  private muted = false

  private readonly listeners = new Set<() => void>()

  constructor(opts: { debounceMs?: number; fadeMs?: number; make?: () => AudioLike } = {}) {
    this.debounceMs = opts.debounceMs ?? HOVER_DEBOUNCE_MS
    this.fadeMs = opts.fadeMs ?? CROSSFADE_MS

    const make = opts.make ?? (() => new Audio() as unknown as AudioLike)
    this.decks = [
      { el: make(), song: null },
      { el: make(), song: null },
    ]
    for (const deck of this.decks) {
      deck.el.volume = 0
      deck.el.muted = false
    }
  }

  get playing(): Song | null {
    return this.decks[this.active]!.song
  }

  get pinned(): Song | null {
    return this.pinnedSong
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  hover(song: Song | null): void {
    if (this.pinnedSong) return // a pinned song owns the audio

    this.clearHoverTimer()
    this.pendingSong = song

    if (song === null) return
    if (this.playing?.id === song.id) return

    this.hoverTimer = setTimeout(() => {
      this.hoverTimer = null
      const next = this.pendingSong
      if (next && this.playing?.id !== next.id) this.start(next)
    }, this.debounceMs)
  }

  pin(song: Song): void {
    this.clearHoverTimer()
    this.pinnedSong = song
    if (this.playing?.id !== song.id) this.start(song)
    else this.emit()
  }

  unpin(): void {
    this.pinnedSong = null
    this.emit()
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v))
    this.decks[this.active]!.el.volume = this.volume
    this.decks[1 - this.active]!.el.volume = Math.min(
      this.decks[1 - this.active]!.el.volume,
      this.volume,
    )
    this.emit()
  }

  setMuted(m: boolean): void {
    this.muted = m
    for (const deck of this.decks) deck.el.muted = m
    this.emit()
  }

  dispose(): void {
    this.clearHoverTimer()
    if (this.fadeTimer !== null) clearInterval(this.fadeTimer)
    for (const deck of this.decks) deck.el.pause()
    this.listeners.clear()
  }

  private start(song: Song): void {
    const outgoing = this.decks[this.active]!
    const incomingIndex = 1 - this.active
    const incoming = this.decks[incomingIndex]!

    incoming.el.src = song.preview
    incoming.el.currentTime = 0
    incoming.el.muted = this.muted
    incoming.el.volume = 0
    incoming.song = song

    void incoming.el.play().catch(() => {
      // Autoplay blocked or a dead preview URL: leave the tile silent
      // rather than throwing. src/audio/unlock.ts handles the first case.
      incoming.song = null
      this.emit()
    })

    this.active = incomingIndex
    this.crossfade(incoming.el, outgoing.el)
    this.emit()
  }

  private crossfade(incoming: AudioLike, outgoing: AudioLike): void {
    if (this.fadeTimer !== null) clearInterval(this.fadeTimer)

    const stepMs = Math.max(1, Math.floor(this.fadeMs / FADE_STEPS))
    const startOut = outgoing.volume
    let step = 0

    this.fadeTimer = setInterval(() => {
      step++
      const t = Math.min(1, step / FADE_STEPS)
      incoming.volume = this.volume * t
      outgoing.volume = startOut * (1 - t)

      if (t >= 1) {
        if (this.fadeTimer !== null) clearInterval(this.fadeTimer)
        this.fadeTimer = null
        outgoing.pause()
      }
    }, stepMs)
  }

  private clearHoverTimer(): void {
    if (this.hoverTimer !== null) {
      clearTimeout(this.hoverTimer)
      this.hoverTimer = null
    }
  }

  private emit(): void {
    for (const cb of this.listeners) cb()
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/audioEngine.test.ts`
Expected: 13 passing. The "hover storm produces exactly one play" test is the one that protects the feel of the product — if it ever fails, the site is unusable.

- [ ] **Step 5: Commit**

```bash
git add src/audio/engine.ts tests/audioEngine.test.ts
git commit -m "feat: add two-deck audio engine with hover debounce and crossfade"
```

### Task 15: Canvas renderer

Draws only visible hexes, and only when something changed. `songAt` is the pure lookup that ties layout, store, and renderer together — it is tested directly; the pixel drawing is verified by eye in Step 6.

**Files:**
- Create: `src/render/tile.ts`, `src/render/canvas.ts`
- Test: `tests/renderer.test.ts`

**Interfaces:**
- Consumes: `AtlasLayout`, `Slot`, `visibleOffsets`, `clampView`, `axialToPixel`, `offsetToAxial`, `HEX_SIZE`, `CellStore`, `ImageCache`, `fallbackColors`, `cellKey`
- Produces:
  - `hexPath(ctx, cx, cy, size): void`, `drawTile(ctx, opts: TileOpts): void`
  - `songAt(o: Offset, layout: AtlasLayout, store: CellStore): Song | null`
  - `class AtlasRenderer` with `constructor(canvas, layout, store, images)`, `view: Point`, `setHover(o: Offset | null)`, `hoverAt(clientX, clientY): Offset | null`, `panBy(dx, dy)`, `resize()`, `invalidate()`, `start()`, `stop()`

- [ ] **Step 1: Write the failing tests**

`tests/renderer.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { AtlasLayout } from '../src/atlas/layout'
import { CellStore } from '../src/data/loader'
import { songAt } from '../src/render/canvas'
import type { Song } from '../src/types'

const layout = new AtlasLayout(['us', 'br'], [14, 21])

function storeWith(key: string, songs: Song[]): CellStore {
  const fetcher = (async () => ({ ok: true, status: 200, json: async () => songs })) as unknown as typeof fetch
  const store = new CellStore({ fetcher })
  store.ensure([key])
  return store
}

function songs(n: number): Song[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `id${i}`, title: `T${i}`, artist: `A${i}`, art: 'art', preview: 'p',
    previewType: 'aac' as const, genre: 14, country: 'us',
    source: 'itunes' as const, link: 'l', yt: 'y',
  }))
}

describe('songAt', () => {
  it('returns null while the cell is still loading', () => {
    const store = storeWith('us-14', songs(50))
    expect(songAt({ col: 0, row: 0 }, layout, store)).toBeNull()
  })

  it('returns the song once the cell is ready', async () => {
    const store = storeWith('us-14', songs(50))
    await vi.waitFor(() => expect(store.status('us-14')).toBe('ready'))
    expect(songAt({ col: 0, row: 0 }, layout, store)?.title).toBe('T0')
    expect(songAt({ col: 1, row: 0 }, layout, store)?.title).toBe('T1')
  })

  it('returns null outside the atlas', async () => {
    const store = storeWith('us-14', songs(50))
    await vi.waitFor(() => expect(store.status('us-14')).toBe('ready'))
    expect(songAt({ col: -1, row: 0 }, layout, store)).toBeNull()
    expect(songAt({ col: 999, row: 0 }, layout, store)).toBeNull()
  })

  it('returns null when the cell is short of that index', async () => {
    const store = storeWith('us-14', songs(3))
    await vi.waitFor(() => expect(store.status('us-14')).toBe('ready'))
    expect(songAt({ col: 0, row: 0 }, layout, store)).not.toBeNull()
    expect(songAt({ col: 4, row: 9 }, layout, store)).toBeNull()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/renderer.test.ts`
Expected: FAIL — cannot resolve `../src/render/canvas`.

- [ ] **Step 3: Implement `src/render/tile.ts`**

```ts
export type TileOpts = {
  cx: number
  cy: number
  size: number
  image: CanvasImageSource | null
  colors: [string, string]
  scale: number
  highlighted: boolean
  dim: boolean
}

/** Pointy-top hexagon path centred on (cx, cy). */
export function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 90)
    const x = cx + size * Math.cos(angle)
    const y = cy + size * Math.sin(angle)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

export function drawTile(ctx: CanvasRenderingContext2D, o: TileOpts): void {
  const size = o.size * o.scale

  ctx.save()
  hexPath(ctx, o.cx, o.cy, size)
  ctx.clip()

  if (o.image) {
    // Album art is square; cover the hex's bounding box.
    const d = size * 2
    ctx.drawImage(o.image, o.cx - d / 2, o.cy - d / 2, d, d)
  } else {
    const g = ctx.createLinearGradient(o.cx - size, o.cy - size, o.cx + size, o.cy + size)
    g.addColorStop(0, o.colors[0])
    g.addColorStop(1, o.colors[1])
    ctx.fillStyle = g
    ctx.fillRect(o.cx - size, o.cy - size, size * 2, size * 2)
  }

  if (o.dim) {
    ctx.fillStyle = 'rgba(7, 7, 12, 0.45)'
    ctx.fillRect(o.cx - size, o.cy - size, size * 2, size * 2)
  }

  ctx.restore()

  if (o.highlighted) {
    hexPath(ctx, o.cx, o.cy, size)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.stroke()
  }
}
```

- [ ] **Step 4: Implement `src/render/canvas.ts`**

```ts
import { axialToPixel, offsetToAxial, pixelToAxial, axialToOffset, HEX_SIZE, type Offset, type Point } from '../atlas/hex'
import { AtlasLayout, CELL_COLS } from '../atlas/layout'
import { clampView, requiredCellKeys, visibleOffsets } from '../atlas/viewport'
import type { CellStore } from '../data/loader'
import { ImageCache, fallbackColors } from './imageCache'
import { drawTile } from './tile'
import { cellKey, type Song } from '../types'

const HOVER_SCALE = 1.45
const TILE_GAP = 0.94

/** Pure lookup: which song lives on this hex, if its cell is loaded? */
export function songAt(o: Offset, layout: AtlasLayout, store: CellStore): Song | null {
  const slot = layout.slotAt(o)
  if (!slot) return null
  const songs = store.get(cellKey(slot.country, slot.genre))
  return songs?.[slot.index] ?? null
}

export class AtlasRenderer {
  view: Point = { x: 0, y: 0 }

  private hover: Offset | null = null
  private dirty = true
  private raf: number | null = null
  private readonly ctx: CanvasRenderingContext2D

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly layout: AtlasLayout,
    private readonly store: CellStore,
    private readonly images: ImageCache,
  ) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d canvas context unavailable')
    this.ctx = ctx

    this.store.onChange(() => this.invalidate())
    this.images.onLoad(() => this.invalidate())
    this.resize()
  }

  get hovered(): Offset | null {
    return this.hover
  }

  invalidate(): void {
    this.dirty = true
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1
    this.canvas.width = Math.floor(window.innerWidth * dpr)
    this.canvas.height = Math.floor(window.innerHeight * dpr)
    this.canvas.style.width = `${window.innerWidth}px`
    this.canvas.style.height = `${window.innerHeight}px`
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.invalidate()
  }

  /** Screen coordinates → the hex under them. */
  hoverAt(clientX: number, clientY: number): Offset | null {
    const world = { x: clientX + this.view.x, y: clientY + this.view.y }
    const o = axialToOffset(pixelToAxial(world))
    return this.layout.slotAt(o) ? o : null
  }

  setHover(o: Offset | null): void {
    if (o?.col === this.hover?.col && o?.row === this.hover?.row) return
    this.hover = o
    this.invalidate()
  }

  panBy(dx: number, dy: number): void {
    const rect = { x: this.view.x + dx, y: this.view.y + dy, w: window.innerWidth, h: window.innerHeight }
    this.view = clampView(rect, this.layout)
    this.invalidate()
  }

  start(): void {
    const loop = (): void => {
      if (this.dirty) {
        this.dirty = false
        this.draw()
      }
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }

  stop(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf)
    this.raf = null
  }

  private draw(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    const rect = { x: this.view.x, y: this.view.y, w, h }

    // Ask for the cells we need; the store notifies us when they land.
    this.store.ensure(requiredCellKeys(rect, this.layout))

    this.ctx.fillStyle = '#07070c'
    this.ctx.fillRect(0, 0, w, h)

    const range = visibleOffsets(rect, this.layout)
    const hasHover = this.hover !== null

    for (let row = range.rowMin; row <= range.rowMax; row++) {
      for (let col = range.colMin; col <= range.colMax; col++) {
        const isHover = this.hover?.col === col && this.hover?.row === row
        const song = songAt({ col, row }, this.layout, this.store)
        const p = axialToPixel(offsetToAxial({ col, row }))

        drawTile(this.ctx, {
          cx: p.x - this.view.x,
          cy: p.y - this.view.y,
          size: HEX_SIZE * TILE_GAP,
          image: song ? this.images.get(song.art) : null,
          colors: song ? fallbackColors(song.id) : ['#15151f', '#0b0b12'],
          scale: isHover ? HOVER_SCALE : 1,
          highlighted: isHover,
          dim: hasHover && !isHover,
        })
      }
    }

    // Redraw the hovered tile last so its scaled-up form sits above neighbours.
    if (this.hover) {
      const song = songAt(this.hover, this.layout, this.store)
      const p = axialToPixel(offsetToAxial(this.hover))
      drawTile(this.ctx, {
        cx: p.x - this.view.x,
        cy: p.y - this.view.y,
        size: HEX_SIZE * TILE_GAP,
        image: song ? this.images.get(song.art) : null,
        colors: song ? fallbackColors(song.id) : ['#15151f', '#0b0b12'],
        scale: HOVER_SCALE,
        highlighted: true,
        dim: false,
      })
    }
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/renderer.test.ts`
Expected: 4 passing.

- [ ] **Step 6: Commit**

```bash
git add src/render/tile.ts src/render/canvas.ts tests/renderer.test.ts
git commit -m "feat: add canvas renderer with dirty-redraw and hover scaling"
```

### Task 16: Autoplay unlock, pointer input, and wiring it all together

The first moment the site is actually usable. After this task you can hover tiles and hear music.

**Files:**
- Create: `src/audio/unlock.ts`, `src/input/pointer.ts`
- Modify: `src/main.ts` (full rewrite), `index.html` (add overlay markup)
- Test: `tests/unlock.test.ts`

**Interfaces:**
- Consumes: `AudioEngine`, `AtlasRenderer`, `AtlasLayout`, `CellStore`, `ImageCache`, `loadManifest`, `songAt`
- Produces:
  - `showUnlockOverlay(root: HTMLElement, onUnlock: () => void): void`
  - `attachPointer(canvas: HTMLCanvasElement, handlers: PointerHandlers): () => void`
  - `type PointerHandlers = { onHover(x: number, y: number): void; onPan(dx: number, dy: number): void; onClick(x: number, y: number): void; onLeave(): void }`

- [ ] **Step 1: Write the failing test**

`tests/unlock.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { showUnlockOverlay } from '../src/audio/unlock'

describe('showUnlockOverlay', () => {
  it('renders an overlay into the root', () => {
    const root = document.createElement('div')
    showUnlockOverlay(root, () => {})
    expect(root.querySelector('[data-unlock]')).not.toBeNull()
  })

  it('calls onUnlock and removes itself when clicked', () => {
    const root = document.createElement('div')
    const onUnlock = vi.fn()
    showUnlockOverlay(root, onUnlock)

    root.querySelector<HTMLElement>('[data-unlock]')!.click()

    expect(onUnlock).toHaveBeenCalledTimes(1)
    expect(root.querySelector('[data-unlock]')).toBeNull()
  })

  it('only fires once even if clicked twice', () => {
    const root = document.createElement('div')
    const onUnlock = vi.fn()
    showUnlockOverlay(root, onUnlock)

    const el = root.querySelector<HTMLElement>('[data-unlock]')!
    el.click()
    el.click()

    expect(onUnlock).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/unlock.test.ts`
Expected: FAIL — cannot resolve `../src/audio/unlock`.

- [ ] **Step 3: Implement `src/audio/unlock.ts`**

```ts
/**
 * Browsers block audio until a user gesture. One click anywhere unlocks
 * playback for the whole session.
 */
export function showUnlockOverlay(root: HTMLElement, onUnlock: () => void): void {
  const el = document.createElement('div')
  el.setAttribute('data-unlock', '')
  el.innerHTML = `
    <div class="unlock-inner">
      <h1>Listen to Anything</h1>
      <p>Every tile is a song. Move your cursor and let it rest.</p>
      <p class="unlock-cta">Click anywhere to start</p>
    </div>
  `

  let fired = false
  el.addEventListener('click', () => {
    if (fired) return
    fired = true
    el.remove()
    onUnlock()
  })

  root.appendChild(el)
}
```

- [ ] **Step 4: Implement `src/input/pointer.ts`**

```ts
export type PointerHandlers = {
  onHover(x: number, y: number): void
  onPan(dx: number, dy: number): void
  onClick(x: number, y: number): void
  onLeave(): void
}

/** A drag longer than this many pixels suppresses the click. */
const DRAG_THRESHOLD = 4

export function attachPointer(canvas: HTMLCanvasElement, h: PointerHandlers): () => void {
  let dragging = false
  let moved = 0
  let lastX = 0
  let lastY = 0

  const onDown = (e: PointerEvent): void => {
    dragging = true
    moved = 0
    lastX = e.clientX
    lastY = e.clientY
    canvas.setPointerCapture(e.pointerId)
  }

  const onMove = (e: PointerEvent): void => {
    if (dragging) {
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      moved += Math.abs(dx) + Math.abs(dy)
      lastX = e.clientX
      lastY = e.clientY
      // Dragging right should reveal what is to the left, so invert.
      h.onPan(-dx, -dy)
    }
    h.onHover(e.clientX, e.clientY)
  }

  const onUp = (e: PointerEvent): void => {
    if (dragging && moved < DRAG_THRESHOLD) h.onClick(e.clientX, e.clientY)
    dragging = false
    canvas.releasePointerCapture(e.pointerId)
  }

  const onLeave = (): void => {
    dragging = false
    h.onLeave()
  }

  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointerleave', onLeave)

  return () => {
    canvas.removeEventListener('pointerdown', onDown)
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerup', onUp)
    canvas.removeEventListener('pointerleave', onLeave)
  }
}
```

- [ ] **Step 5: Rewrite `src/main.ts`**

```ts
import { AtlasLayout } from './atlas/layout'
import { CellStore, loadManifest } from './data/loader'
import { ImageCache } from './render/imageCache'
import { AtlasRenderer, songAt } from './render/canvas'
import { AudioEngine } from './audio/engine'
import { showUnlockOverlay } from './audio/unlock'
import { attachPointer } from './input/pointer'

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#atlas')
  const root = document.querySelector<HTMLElement>('#ui')
  if (!canvas || !root) throw new Error('missing #atlas or #ui')

  const manifest = await loadManifest()
  const layout = new AtlasLayout(
    manifest.countries,
    manifest.genres.map((g) => g.id),
  )

  const store = new CellStore()
  const images = new ImageCache()
  const renderer = new AtlasRenderer(canvas, layout, store, images)
  const audio = new AudioEngine()

  renderer.start()
  window.addEventListener('resize', () => renderer.resize())

  attachPointer(canvas, {
    onHover: (x, y) => {
      const hex = renderer.hoverAt(x, y)
      renderer.setHover(hex)
      audio.hover(hex ? songAt(hex, layout, store) : null)
    },
    onPan: (dx, dy) => renderer.panBy(dx, dy),
    onClick: (x, y) => {
      const hex = renderer.hoverAt(x, y)
      const song = hex ? songAt(hex, layout, store) : null
      if (!song) return
      if (audio.pinned?.id === song.id) audio.unpin()
      else audio.pin(song)
    },
    onLeave: () => {
      renderer.setHover(null)
      audio.hover(null)
    },
  })

  showUnlockOverlay(root, () => {
    audio.setVolume(1)
  })
}

void boot().catch((err: unknown) => {
  document.body.innerHTML =
    `<p style="color:#c9c9de;font:16px system-ui;padding:2rem">` +
    `Could not start: ${(err as Error).message}</p>`
})
```

- [ ] **Step 6: Update `index.html`**

Add a `#ui` layer above the canvas and style the overlay. Replace the `<body>` and `<style>` contents:

```html
<style>
  html, body { margin: 0; height: 100%; background: #07070c; overflow: hidden; }
  canvas { display: block; position: fixed; inset: 0; }
  #ui { position: fixed; inset: 0; pointer-events: none; }
  #ui > * { pointer-events: auto; }
  [data-unlock] {
    position: fixed; inset: 0; display: grid; place-items: center;
    background: rgba(7,7,12,.82); backdrop-filter: blur(6px);
    color: #ececf5; font: 16px/1.5 system-ui, sans-serif; text-align: center;
    cursor: pointer;
  }
  [data-unlock] h1 { font-size: 2rem; margin: 0 0 .5rem; letter-spacing: -.02em; }
  [data-unlock] p { margin: .25rem 0; color: #a9a9c0; }
  .unlock-cta { margin-top: 1.25rem !important; color: #ececf5 !important; font-weight: 600; }
</style>
...
<body>
  <canvas id="atlas"></canvas>
  <div id="ui"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
```

- [ ] **Step 7: Run it for real**

Ensure at least a few cells exist in `public/data/` (from Task 11 Step 5), then:

Run: `npm run dev`

Verify by hand:
- The unlock overlay appears; clicking it dismisses it.
- Tiles show album art; tiles in unloaded cells show gradients.
- Resting the cursor on a tile scales it up and plays audio after a beat.
- Sweeping the cursor quickly across the screen plays **nothing** until you stop.
- Dragging pans the atlas; new tiles stream in without a visible gap.
- Clicking a tile pins it — the song keeps playing while you hover elsewhere. Clicking it again unpins.

- [ ] **Step 8: Run the full suite and commit**

Run: `npm test`

```bash
git add src/audio/unlock.ts src/input/pointer.ts src/main.ts index.html tests/unlock.test.ts
git commit -m "feat: wire renderer, audio, and pointer input into a playable atlas"
```

**Milestone 3 complete.** The core product works: hover to listen, drag to travel, click to pin.

---

## Milestone 4 — Navigation

### Task 17: Axis HUD

Always-visible readout of where you are. Without it, drifting is disorienting.

**Files:**
- Create: `src/ui/axisLabels.ts`
- Modify: `src/main.ts`, `index.html` (styles)
- Test: `tests/axisLabels.test.ts`

**Interfaces:**
- Consumes: `AtlasLayout`, `Offset`, `Manifest`
- Produces: `class AxisHud` with `constructor(root: HTMLElement, layout: AtlasLayout, genreLabels: Map<GenreId, string>)`, `update(o: Offset | null): void`

- [ ] **Step 1: Write the failing test**

`tests/axisLabels.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { AtlasLayout, CELL_COLS, CELL_ROWS } from '../src/atlas/layout'
import { AxisHud } from '../src/ui/axisLabels'

const layout = new AtlasLayout(['us', 'br'], [14, 21])
const labels = new Map([[14, 'Pop'], [21, 'Rock']])

describe('AxisHud', () => {
  it('shows the country and genre under the cursor', () => {
    const root = document.createElement('div')
    const hud = new AxisHud(root, layout, labels)
    hud.update({ col: 0, row: 0 })
    expect(root.textContent).toContain('United States')
    expect(root.textContent).toContain('Pop')
  })

  it('updates when the cursor moves to another cell', () => {
    const root = document.createElement('div')
    const hud = new AxisHud(root, layout, labels)
    hud.update({ col: CELL_COLS, row: CELL_ROWS })
    expect(root.textContent).toContain('Brazil')
    expect(root.textContent).toContain('Rock')
  })

  it('falls back to the raw code for an unknown country', () => {
    const odd = new AtlasLayout(['zq'], [14])
    const root = document.createElement('div')
    new AxisHud(root, odd, labels).update({ col: 0, row: 0 })
    expect(root.textContent).toContain('ZQ')
  })

  it('keeps the last known position when the cursor leaves', () => {
    const root = document.createElement('div')
    const hud = new AxisHud(root, layout, labels)
    hud.update({ col: 0, row: 0 })
    hud.update(null)
    expect(root.textContent).toContain('United States')
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/axisLabels.test.ts`
Expected: FAIL — cannot resolve `../src/ui/axisLabels`.

- [ ] **Step 3: Implement `src/ui/axisLabels.ts`**

```ts
import type { Offset } from '../atlas/hex'
import type { AtlasLayout } from '../atlas/layout'
import type { GenreId } from '../types'

/** Uses the platform's own country-name table — no list to maintain. */
const countryNames = new Intl.DisplayNames(['en'], { type: 'region' })

export function countryName(code: string): string {
  try {
    return countryNames.of(code.toUpperCase()) ?? code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}

export class AxisHud {
  private readonly el: HTMLElement

  constructor(
    root: HTMLElement,
    private readonly layout: AtlasLayout,
    private readonly genreLabels: Map<GenreId, string>,
  ) {
    this.el = document.createElement('div')
    this.el.className = 'axis-hud'
    this.el.setAttribute('data-axis-hud', '')
    root.appendChild(this.el)
  }

  update(o: Offset | null): void {
    if (o === null) return // keep the last known position rather than blanking
    const slot = this.layout.slotAt(o)
    if (!slot) return

    this.el.innerHTML = `
      <span class="axis-country">${countryName(slot.country)}</span>
      <span class="axis-sep">·</span>
      <span class="axis-genre">${this.genreLabels.get(slot.genre) ?? slot.genre}</span>
    `
  }
}
```

- [ ] **Step 4: Wire it into `src/main.ts`**

After `const renderer = ...`, add:

```ts
const genreLabels = new Map(manifest.genres.map((g) => [g.id, g.label]))
const hud = new AxisHud(root, layout, genreLabels)
```

and inside `onHover`, after `renderer.setHover(hex)`:

```ts
hud.update(hex)
```

Import it: `import { AxisHud } from './ui/axisLabels'`

- [ ] **Step 5: Add styles to `index.html`**

```css
.axis-hud {
  position: fixed; top: 18px; left: 20px;
  font: 600 13px/1 system-ui, sans-serif; letter-spacing: .04em;
  color: #ececf5; text-transform: uppercase;
  text-shadow: 0 1px 8px rgba(0,0,0,.9);
}
.axis-sep { opacity: .45; margin: 0 .5em; }
.axis-genre { color: #a9a9c0; }
```

- [ ] **Step 6: Run tests and commit**

Run: `npx vitest run tests/axisLabels.test.ts`
Expected: 4 passing.

```bash
git add src/ui/axisLabels.ts src/main.ts index.html tests/axisLabels.test.ts
git commit -m "feat: add always-visible country/genre axis readout"
```

### Task 18: Now-playing card

**Files:**
- Create: `src/ui/nowPlaying.ts`
- Modify: `src/main.ts`, `index.html` (styles)
- Test: `tests/nowPlaying.test.ts`

**Interfaces:**
- Consumes: `Song`, `AudioEngine`
- Produces: `class NowPlayingCard` with `constructor(root: HTMLElement, onClose: () => void)`, `show(song: Song): void`, `hide(): void`

- [ ] **Step 1: Write the failing test**

`tests/nowPlaying.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { NowPlayingCard } from '../src/ui/nowPlaying'
import type { Song } from '../src/types'

const song: Song = {
  id: 'a', title: 'Track Title', artist: 'Artist Name', album: 'Album Name',
  art: 'https://cdn/art.jpg', preview: 'https://cdn/p.m4a', previewType: 'aac',
  genre: 14, country: 'us', source: 'itunes',
  link: 'https://music.apple.com/x', yt: 'https://www.youtube.com/results?search_query=x',
}

describe('NowPlayingCard', () => {
  it('is hidden until shown', () => {
    const root = document.createElement('div')
    new NowPlayingCard(root, () => {})
    expect(root.querySelector('[data-now-playing].visible')).toBeNull()
  })

  it('shows title, artist and album', () => {
    const root = document.createElement('div')
    const card = new NowPlayingCard(root, () => {})
    card.show(song)
    const text = root.textContent ?? ''
    expect(text).toContain('Track Title')
    expect(text).toContain('Artist Name')
    expect(text).toContain('Album Name')
  })

  it('links out to YouTube and the store page', () => {
    const root = document.createElement('div')
    new NowPlayingCard(root, () => {}).show(song)
    const hrefs = [...root.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(hrefs).toContain(song.yt)
    expect(hrefs).toContain(song.link)
  })

  it('opens outbound links in a new tab safely', () => {
    const root = document.createElement('div')
    new NowPlayingCard(root, () => {}).show(song)
    for (const a of root.querySelectorAll('a')) {
      expect(a.getAttribute('target')).toBe('_blank')
      expect(a.getAttribute('rel')).toContain('noopener')
    }
  })

  it('calls onClose when the close button is clicked', () => {
    const root = document.createElement('div')
    const onClose = vi.fn()
    const card = new NowPlayingCard(root, onClose)
    card.show(song)
    root.querySelector<HTMLElement>('[data-close]')!.click()
    expect(onClose).toHaveBeenCalled()
  })

  it('escapes markup in song text rather than injecting it', () => {
    const root = document.createElement('div')
    const card = new NowPlayingCard(root, () => {})
    card.show({ ...song, title: '<img src=x onerror=alert(1)>' })
    expect(root.querySelector('img')).toBeNull()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/nowPlaying.test.ts`
Expected: FAIL — cannot resolve `../src/ui/nowPlaying`.

- [ ] **Step 3: Implement `src/ui/nowPlaying.ts`**

Song titles and artist names come from a third-party feed, so they are inserted as text nodes, never as HTML.

```ts
import type { Song } from '../types'

export class NowPlayingCard {
  private readonly el: HTMLElement

  constructor(root: HTMLElement, private readonly onClose: () => void) {
    this.el = document.createElement('aside')
    this.el.setAttribute('data-now-playing', '')
    this.el.className = 'now-playing'
    root.appendChild(this.el)
  }

  show(song: Song): void {
    this.el.replaceChildren()

    const art = document.createElement('img')
    art.src = song.art
    art.alt = ''
    art.className = 'np-art'

    const body = document.createElement('div')
    body.className = 'np-body'

    const title = document.createElement('h2')
    title.textContent = song.title            // text node: no markup injection

    const artist = document.createElement('p')
    artist.className = 'np-artist'
    artist.textContent = song.artist

    body.append(title, artist)

    if (song.album) {
      const album = document.createElement('p')
      album.className = 'np-album'
      album.textContent = song.album
      body.appendChild(album)
    }

    const links = document.createElement('div')
    links.className = 'np-links'
    links.append(
      this.link(song.yt, 'Full song on YouTube'),
      this.link(song.link, 'Store page'),
    )
    body.appendChild(links)

    const close = document.createElement('button')
    close.setAttribute('data-close', '')
    close.className = 'np-close'
    close.textContent = '×'
    close.setAttribute('aria-label', 'Unpin song')
    close.addEventListener('click', () => this.onClose())

    this.el.append(art, body, close)
    this.el.classList.add('visible')
  }

  hide(): void {
    this.el.classList.remove('visible')
    this.el.replaceChildren()
  }

  private link(href: string, text: string): HTMLAnchorElement {
    const a = document.createElement('a')
    a.href = href
    a.textContent = text
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    return a
  }
}
```

- [ ] **Step 4: Wire into `src/main.ts`**

```ts
import { NowPlayingCard } from './ui/nowPlaying'

const card = new NowPlayingCard(root, () => {
  audio.unpin()
  card.hide()
})
```

Replace the `onClick` body:

```ts
onClick: (x, y) => {
  const hex = renderer.hoverAt(x, y)
  const song = hex ? songAt(hex, layout, store) : null
  if (!song) return
  if (audio.pinned?.id === song.id) {
    audio.unpin()
    card.hide()
  } else {
    audio.pin(song)
    card.show(song)
  }
},
```

- [ ] **Step 5: Add styles to `index.html`**

```css
.now-playing {
  position: fixed; left: 20px; bottom: 20px; width: min(360px, calc(100vw - 40px));
  display: none; gap: 14px; padding: 14px;
  background: rgba(16,16,24,.92); border: 1px solid #2a2a3c; border-radius: 12px;
  backdrop-filter: blur(10px); color: #ececf5; font: 14px/1.4 system-ui, sans-serif;
}
.now-playing.visible { display: flex; }
.np-art { width: 76px; height: 76px; border-radius: 6px; object-fit: cover; flex: none; }
.np-body { min-width: 0; }
.now-playing h2 { margin: 0 0 2px; font-size: 15px; }
.np-artist { margin: 0; color: #c9c9de; }
.np-album { margin: 2px 0 0; color: #85859c; font-size: 12px; }
.np-links { margin-top: 8px; display: flex; gap: 12px; flex-wrap: wrap; }
.np-links a { color: #ff7a45; font-size: 12px; }
.np-close {
  position: absolute; top: 8px; right: 10px; background: none; border: 0;
  color: #85859c; font-size: 20px; cursor: pointer; line-height: 1;
}
```

- [ ] **Step 6: Run tests and commit**

Run: `npx vitest run tests/nowPlaying.test.ts`
Expected: 6 passing.

```bash
git add src/ui/nowPlaying.ts src/main.ts index.html tests/nowPlaying.test.ts
git commit -m "feat: add pinned-song detail card with outbound links"
```

### Task 19: Minimap and jump-to search

**Files:**
- Create: `src/ui/minimap.ts`, `src/ui/search.ts`
- Modify: `src/main.ts`, `index.html` (styles)
- Test: `tests/search.test.ts`

**Interfaces:**
- Consumes: `AtlasLayout`, `countryName`, `Manifest`
- Produces:
  - `class Minimap` with `constructor(root, layout, onJump: (world: Point) => void)`, `update(view: Rect): void`
  - `type JumpTarget = { kind: 'country' | 'genre'; label: string; country?: string; genre?: GenreId }`
  - `buildTargets(layout, genreLabels): JumpTarget[]`
  - `searchTargets(targets: JumpTarget[], query: string): JumpTarget[]`
  - `class SearchBox` with `constructor(root, targets, onPick: (t: JumpTarget) => void)`

- [ ] **Step 1: Write the failing tests**

`tests/search.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { AtlasLayout } from '../src/atlas/layout'
import { buildTargets, searchTargets } from '../src/ui/search'

const layout = new AtlasLayout(['us', 'br', 'jp'], [14, 21])
const labels = new Map([[14, 'Pop'], [21, 'Rock']])
const targets = buildTargets(layout, labels)

describe('buildTargets', () => {
  it('produces one target per country and per genre', () => {
    expect(targets).toHaveLength(3 + 2)
  })

  it('uses full country names', () => {
    expect(targets.some((t) => t.label === 'Brazil')).toBe(true)
  })
})

describe('searchTargets', () => {
  it('matches a country by prefix', () => {
    expect(searchTargets(targets, 'bra')[0]!.label).toBe('Brazil')
  })

  it('matches a genre', () => {
    expect(searchTargets(targets, 'rock')[0]!.label).toBe('Rock')
  })

  it('is case insensitive', () => {
    expect(searchTargets(targets, 'JAPAN')[0]!.label).toBe('Japan')
  })

  it('ranks a prefix match above a substring match', () => {
    const results = searchTargets(targets, 'pa')      // "Japan" contains it
    expect(results.length).toBeGreaterThan(0)
  })

  it('returns nothing for an empty query', () => {
    expect(searchTargets(targets, '')).toEqual([])
  })

  it('returns nothing when there is no match', () => {
    expect(searchTargets(targets, 'zzzzz')).toEqual([])
  })

  it('caps the number of results', () => {
    expect(searchTargets(targets, 'a').length).toBeLessThanOrEqual(8)
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/search.test.ts`
Expected: FAIL — cannot resolve `../src/ui/search`.

- [ ] **Step 3: Implement `src/ui/search.ts`**

```ts
import type { AtlasLayout } from '../atlas/layout'
import type { GenreId } from '../types'
import { countryName } from './axisLabels'

export type JumpTarget = {
  kind: 'country' | 'genre'
  label: string
  country?: string
  genre?: GenreId
}

const MAX_RESULTS = 8

export function buildTargets(
  layout: AtlasLayout,
  genreLabels: Map<GenreId, string>,
): JumpTarget[] {
  return [
    ...layout.countries.map((c) => ({
      kind: 'country' as const,
      label: countryName(c),
      country: c,
    })),
    ...layout.genres.map((g) => ({
      kind: 'genre' as const,
      label: genreLabels.get(g) ?? String(g),
      genre: g,
    })),
  ]
}

export function searchTargets(targets: JumpTarget[], query: string): JumpTarget[] {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return []

  return targets
    .map((t) => ({ t, at: t.label.toLowerCase().indexOf(q) }))
    .filter((r) => r.at >= 0)
    .sort((a, b) => a.at - b.at || a.t.label.localeCompare(b.t.label))
    .slice(0, MAX_RESULTS)
    .map((r) => r.t)
}

export class SearchBox {
  constructor(root: HTMLElement, targets: JumpTarget[], onPick: (t: JumpTarget) => void) {
    const wrap = document.createElement('div')
    wrap.className = 'search'

    const input = document.createElement('input')
    input.type = 'search'
    input.placeholder = 'Jump to a country or genre…'
    input.setAttribute('data-search', '')

    const list = document.createElement('ul')
    list.className = 'search-results'

    const render = (): void => {
      list.replaceChildren()
      for (const t of searchTargets(targets, input.value)) {
        const li = document.createElement('li')
        li.textContent = t.label
        li.addEventListener('mousedown', (e) => {
          e.preventDefault()
          onPick(t)
          input.value = ''
          render()
          input.blur()
        })
        list.appendChild(li)
      }
    }

    input.addEventListener('input', render)
    input.addEventListener('blur', () => setTimeout(() => list.replaceChildren(), 120))

    wrap.append(input, list)
    root.appendChild(wrap)
  }
}
```

- [ ] **Step 4: Implement `src/ui/minimap.ts`**

```ts
import type { Point } from '../atlas/hex'
import type { AtlasLayout } from '../atlas/layout'
import type { Rect } from '../atlas/viewport'

const WIDTH = 160
const HEIGHT = 96

export class Minimap {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D

  constructor(
    root: HTMLElement,
    private readonly layout: AtlasLayout,
    onJump: (world: Point) => void,
  ) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = WIDTH
    this.canvas.height = HEIGHT
    this.canvas.className = 'minimap'
    this.canvas.setAttribute('data-minimap', '')

    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('2d context unavailable for minimap')
    this.ctx = ctx

    this.canvas.addEventListener('click', (e) => {
      const r = this.canvas.getBoundingClientRect()
      onJump({
        x: ((e.clientX - r.left) / r.width) * layout.widthPx,
        y: ((e.clientY - r.top) / r.height) * layout.heightPx,
      })
    })

    root.appendChild(this.canvas)
  }

  update(view: Rect): void {
    const sx = WIDTH / this.layout.widthPx
    const sy = HEIGHT / this.layout.heightPx

    this.ctx.fillStyle = 'rgba(16,16,24,.9)'
    this.ctx.fillRect(0, 0, WIDTH, HEIGHT)

    // Genre bands, so the map reads as rows of related styles.
    const bandH = HEIGHT / this.layout.genres.length
    for (let i = 0; i < this.layout.genres.length; i++) {
      this.ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.02)'
      this.ctx.fillRect(0, i * bandH, WIDTH, bandH)
    }

    this.ctx.strokeStyle = '#ff7a45'
    this.ctx.lineWidth = 1.5
    this.ctx.strokeRect(
      view.x * sx,
      view.y * sy,
      Math.max(3, view.w * sx),
      Math.max(3, view.h * sy),
    )
  }
}
```

- [ ] **Step 5: Wire both into `src/main.ts`**

```ts
import { Minimap } from './ui/minimap'
import { SearchBox, buildTargets } from './ui/search'

const minimap = new Minimap(root, layout, (world) => {
  renderer.view = { x: 0, y: 0 }
  renderer.panBy(world.x - window.innerWidth / 2, world.y - window.innerHeight / 2)
  minimap.update({ ...renderer.view, w: window.innerWidth, h: window.innerHeight })
})
minimap.update({ ...renderer.view, w: window.innerWidth, h: window.innerHeight })

new SearchBox(root, buildTargets(layout, genreLabels), (t) => {
  const centre =
    t.kind === 'country'
      ? layout.centreOf({ country: t.country!, genre: layout.genres[0]! })
      : layout.centreOf({ country: layout.countries[0]!, genre: t.genre! })
  if (!centre) return
  renderer.view = { x: 0, y: 0 }
  renderer.panBy(centre.x - window.innerWidth / 2, centre.y - window.innerHeight / 2)
  minimap.update({ ...renderer.view, w: window.innerWidth, h: window.innerHeight })
})
```

In `onPan`, after `renderer.panBy(dx, dy)`, add:
```ts
minimap.update({ ...renderer.view, w: window.innerWidth, h: window.innerHeight })
```

- [ ] **Step 6: Add styles to `index.html`**

```css
.minimap {
  position: fixed; right: 20px; bottom: 20px;
  border: 1px solid #2a2a3c; border-radius: 8px; cursor: crosshair;
}
.search { position: fixed; top: 16px; right: 20px; width: 240px; }
.search input {
  width: 100%; padding: 8px 10px; border-radius: 8px;
  border: 1px solid #2a2a3c; background: rgba(16,16,24,.92); color: #ececf5;
  font: 13px system-ui, sans-serif;
}
.search-results { list-style: none; margin: 6px 0 0; padding: 0; }
.search-results li {
  padding: 7px 10px; background: rgba(16,16,24,.96); color: #ececf5;
  border: 1px solid #2a2a3c; border-top: 0; font: 13px system-ui, sans-serif; cursor: pointer;
}
.search-results li:hover { background: #23233a; }
```

- [ ] **Step 7: Run tests, verify by hand, commit**

Run: `npx vitest run tests/search.test.ts`
Expected: 9 passing.

Run: `npm run dev` — confirm the minimap tracks panning, clicking it jumps, and typing "Brazil" then clicking the result moves the atlas.

```bash
git add src/ui/minimap.ts src/ui/search.ts src/main.ts index.html tests/search.test.ts
git commit -m "feat: add minimap and jump-to search"
```

**Milestone 4 complete.** The atlas is navigable at scale.

---

## Milestone 5 — Hardening and mobile

### Task 20: Touch fallback

Hover does not exist on touch. Same data, same renderer, different input layer: drag to pan, tap to play.

**Files:**
- Create: `src/input/touch.ts`
- Modify: `src/main.ts`
- Test: `tests/touch.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `isTouchDevice(): boolean`, `attachTouch(canvas: HTMLCanvasElement, h: TouchHandlers): () => void`, `type TouchHandlers = { onTap(x: number, y: number): void; onPan(dx: number, dy: number): void }`

- [ ] **Step 1: Write the failing test**

`tests/touch.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { attachTouch } from '../src/input/touch'

function pointerEvent(type: string, x: number, y: number): PointerEvent {
  return new PointerEvent(type, {
    clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', bubbles: true,
  })
}

describe('attachTouch', () => {
  it('treats a short press as a tap', () => {
    const canvas = document.createElement('canvas')
    canvas.setPointerCapture = vi.fn()
    canvas.releasePointerCapture = vi.fn()
    const onTap = vi.fn()
    attachTouch(canvas, { onTap, onPan: vi.fn() })

    canvas.dispatchEvent(pointerEvent('pointerdown', 100, 100))
    canvas.dispatchEvent(pointerEvent('pointerup', 101, 101))

    expect(onTap).toHaveBeenCalledWith(101, 101)
  })

  it('treats a drag as a pan, not a tap', () => {
    const canvas = document.createElement('canvas')
    canvas.setPointerCapture = vi.fn()
    canvas.releasePointerCapture = vi.fn()
    const onTap = vi.fn()
    const onPan = vi.fn()
    attachTouch(canvas, { onTap, onPan })

    canvas.dispatchEvent(pointerEvent('pointerdown', 100, 100))
    canvas.dispatchEvent(pointerEvent('pointermove', 160, 140))
    canvas.dispatchEvent(pointerEvent('pointerup', 160, 140))

    expect(onPan).toHaveBeenCalled()
    expect(onTap).not.toHaveBeenCalled()
  })

  it('detaches cleanly', () => {
    const canvas = document.createElement('canvas')
    canvas.setPointerCapture = vi.fn()
    canvas.releasePointerCapture = vi.fn()
    const onTap = vi.fn()
    const detach = attachTouch(canvas, { onTap, onPan: vi.fn() })
    detach()

    canvas.dispatchEvent(pointerEvent('pointerdown', 10, 10))
    canvas.dispatchEvent(pointerEvent('pointerup', 10, 10))

    expect(onTap).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/touch.test.ts`
Expected: FAIL — cannot resolve `../src/input/touch`.

- [ ] **Step 3: Implement `src/input/touch.ts`**

```ts
export type TouchHandlers = {
  onTap(x: number, y: number): void
  onPan(dx: number, dy: number): void
}

const TAP_THRESHOLD = 10

export function isTouchDevice(): boolean {
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches
}

export function attachTouch(canvas: HTMLCanvasElement, h: TouchHandlers): () => void {
  let down = false
  let moved = 0
  let lastX = 0
  let lastY = 0

  const onDown = (e: PointerEvent): void => {
    down = true
    moved = 0
    lastX = e.clientX
    lastY = e.clientY
    canvas.setPointerCapture(e.pointerId)
  }

  const onMove = (e: PointerEvent): void => {
    if (!down) return
    const dx = e.clientX - lastX
    const dy = e.clientY - lastY
    moved += Math.abs(dx) + Math.abs(dy)
    lastX = e.clientX
    lastY = e.clientY
    h.onPan(-dx, -dy)
  }

  const onUp = (e: PointerEvent): void => {
    if (down && moved < TAP_THRESHOLD) h.onTap(e.clientX, e.clientY)
    down = false
    canvas.releasePointerCapture(e.pointerId)
  }

  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)

  return () => {
    canvas.removeEventListener('pointerdown', onDown)
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerup', onUp)
  }
}
```

- [ ] **Step 4: Branch the input layer in `src/main.ts`**

Replace the single `attachPointer(...)` call with:

```ts
import { attachTouch, isTouchDevice } from './input/touch'

const playAt = (x: number, y: number): void => {
  const hex = renderer.hoverAt(x, y)
  const song = hex ? songAt(hex, layout, store) : null
  renderer.setHover(hex)
  hud.update(hex)
  if (!song) return
  audio.pin(song)
  card.show(song)
}

const syncMinimap = (): void =>
  minimap.update({ ...renderer.view, w: window.innerWidth, h: window.innerHeight })

if (isTouchDevice()) {
  attachTouch(canvas, {
    onTap: playAt,
    onPan: (dx, dy) => {
      renderer.panBy(dx, dy)
      syncMinimap()
    },
  })
} else {
  attachPointer(canvas, {
    onHover: (x, y) => {
      const hex = renderer.hoverAt(x, y)
      renderer.setHover(hex)
      hud.update(hex)
      audio.hover(hex ? songAt(hex, layout, store) : null)
    },
    onPan: (dx, dy) => {
      renderer.panBy(dx, dy)
      syncMinimap()
    },
    onClick: (x, y) => {
      const hex = renderer.hoverAt(x, y)
      const song = hex ? songAt(hex, layout, store) : null
      if (!song) return
      if (audio.pinned?.id === song.id) {
        audio.unpin()
        card.hide()
      } else {
        audio.pin(song)
        card.show(song)
      }
    },
    onLeave: () => {
      renderer.setHover(null)
      audio.hover(null)
    },
  })
}
```

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run tests/touch.test.ts`
Expected: 3 passing.

```bash
git add src/input/touch.ts src/main.ts tests/touch.test.ts
git commit -m "feat: add touch input fallback for phones"
```

### Task 21: Architecture guard test and Playwright smoke test

The guard test is the only thing that keeps the "browser makes zero API calls" constraint true as the code grows.

**Files:**
- Create: `tests/architecture.test.ts`, `tests/e2e/smoke.spec.ts`, `playwright.config.ts`
- Modify: `package.json` (add `test:e2e`)

**Interfaces:**
- Consumes: everything built so far
- Produces: `npm run test:e2e`

- [ ] **Step 1: Write the architecture guard test**

`tests/architecture.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (e) => {
      const p = join(dir, e.name)
      return e.isDirectory() ? walk(p) : [p]
    }),
  )
  return files.flat().filter((f) => f.endsWith('.ts'))
}

const FORBIDDEN = [
  'itunes.apple.com',
  'rss.applemarketingtools.com',
  'api.deezer.com',
  'api.jamendo.com',
  'googleapis.com',
]

describe('browser bundle isolation', () => {
  it('never references a music API host', async () => {
    for (const file of await walk('src')) {
      const text = await readFile(file, 'utf8')
      for (const host of FORBIDDEN) {
        expect(text, `${file} must not call ${host} — harvest owns that`).not.toContain(host)
      }
    }
  })

  it('never imports Node built-ins', async () => {
    for (const file of await walk('src')) {
      const text = await readFile(file, 'utf8')
      expect(text, `${file} imports a Node module`).not.toMatch(/from\s+['"]node:/)
    }
  })

  it('only imports pure modules from harvest/', async () => {
    const allowed = /from\s+['"]\.\.?\/(\.\.\/)?harvest\/(types|taxonomy)['"]/
    for (const file of await walk('src')) {
      const text = await readFile(file, 'utf8')
      const harvestImports = text.match(/from\s+['"][^'"]*harvest\/[^'"]+['"]/g) ?? []
      for (const imp of harvestImports) {
        expect(imp, `${file}: only harvest/types and harvest/taxonomy may be imported`)
          .toMatch(allowed)
      }
    }
  })
})
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/architecture.test.ts`
Expected: 3 passing. If the third fails, `src/render/canvas.ts` or similar is importing something Node-only — fix the import, not the test.

- [ ] **Step 3: Add Playwright**

```bash
npm i -D @playwright/test
npx playwright install chromium
```

`playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: 'http://localhost:4173' },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
```

Add to `package.json` scripts: `"test:e2e": "playwright test"`

- [ ] **Step 4: Write the smoke test**

`tests/e2e/smoke.spec.ts`:
```ts
import { test, expect } from '@playwright/test'

test('unlock, hover, and hear a preview', async ({ page }) => {
  const played: string[] = []
  await page.exposeFunction('__recordPlay', (src: string) => { played.push(src) })

  await page.addInitScript(() => {
    const original = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      ;(window as any).__recordPlay?.(this.src)
      return original.call(this).catch(() => undefined)
    }
  })

  await page.goto('/')

  // The unlock overlay gates audio.
  const overlay = page.locator('[data-unlock]')
  await expect(overlay).toBeVisible()
  await overlay.click()
  await expect(overlay).toHaveCount(0)

  // Settle the cursor mid-canvas and wait past the debounce.
  await page.mouse.move(640, 400)
  await page.waitForTimeout(600)

  expect(played.length).toBeGreaterThan(0)
  expect(played[0]).toMatch(/^https?:\/\//)
})

test('the axis readout names a country and genre', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-unlock]').click()
  await page.mouse.move(640, 400)
  await expect(page.locator('[data-axis-hud]')).not.toBeEmpty()
})

test('dragging pans the atlas without errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('/')
  await page.locator('[data-unlock]').click()
  await page.mouse.move(640, 400)
  await page.mouse.down()
  await page.mouse.move(300, 250, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(400)

  expect(errors).toEqual([])
})
```

- [ ] **Step 5: Run it**

Run: `npm run test:e2e`
Expected: 3 passing. Requires `public/data/` to be populated.

- [ ] **Step 6: Commit**

```bash
git add tests/architecture.test.ts tests/e2e playwright.config.ts package.json
git commit -m "test: add architecture guard and Playwright smoke tests"
```

### Task 22: Stale-data notice and the live contract test

The contract test is deliberately excluded from CI — it hits real APIs, so a network blip must never fail a build. It is how you learn Apple changed the feed before users do.

**Files:**
- Create: `src/ui/staleNotice.ts`, `tests/contract/live.contract.ts`
- Modify: `src/main.ts`, `package.json`, `index.html` (styles)
- Test: `tests/staleNotice.test.ts`

**Interfaces:**
- Consumes: `Manifest`
- Produces: `const STALE_AFTER_DAYS = 30`, `isStale(harvestedAt: string, now?: Date): boolean`, `showStaleNotice(root: HTMLElement, harvestedAt: string): void`

- [ ] **Step 1: Write the failing test**

`tests/staleNotice.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { isStale, showStaleNotice, STALE_AFTER_DAYS } from '../src/ui/staleNotice'

const now = new Date('2026-08-03T00:00:00Z')

describe('isStale', () => {
  it('is false for a fresh harvest', () => {
    expect(isStale('2026-08-01T00:00:00Z', now)).toBe(false)
  })

  it('is true past the threshold', () => {
    expect(isStale('2026-01-01T00:00:00Z', now)).toBe(true)
  })

  it('is false exactly at the threshold', () => {
    const at = new Date(now.getTime() - STALE_AFTER_DAYS * 86_400_000).toISOString()
    expect(isStale(at, now)).toBe(false)
  })

  it('treats an unparseable date as stale', () => {
    expect(isStale('not a date', now)).toBe(true)
  })
})

describe('showStaleNotice', () => {
  it('adds a notice when stale', () => {
    const root = document.createElement('div')
    showStaleNotice(root, '2026-01-01T00:00:00Z')
    expect(root.querySelector('[data-stale]')).not.toBeNull()
  })

  it('adds nothing when fresh', () => {
    const root = document.createElement('div')
    showStaleNotice(root, new Date().toISOString())
    expect(root.querySelector('[data-stale]')).toBeNull()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/staleNotice.test.ts`
Expected: FAIL — cannot resolve `../src/ui/staleNotice`.

- [ ] **Step 3: Implement `src/ui/staleNotice.ts`**

```ts
export const STALE_AFTER_DAYS = 30

export function isStale(harvestedAt: string, now: Date = new Date()): boolean {
  const then = Date.parse(harvestedAt)
  if (Number.isNaN(then)) return true
  const ageDays = (now.getTime() - then) / 86_400_000
  return ageDays > STALE_AFTER_DAYS
}

export function showStaleNotice(root: HTMLElement, harvestedAt: string): void {
  if (!isStale(harvestedAt)) return

  const el = document.createElement('p')
  el.setAttribute('data-stale', '')
  el.className = 'stale-notice'
  el.textContent = `Catalogue last refreshed ${new Date(harvestedAt).toLocaleDateString()}`
  root.appendChild(el)
}
```

Wire into `src/main.ts` after the manifest loads:
```ts
import { showStaleNotice } from './ui/staleNotice'
showStaleNotice(root, manifest.harvestedAt)
```

Style in `index.html`:
```css
.stale-notice {
  position: fixed; bottom: 8px; left: 50%; transform: translateX(-50%);
  margin: 0; color: #6a6a80; font: 11px system-ui, sans-serif;
}
```

- [ ] **Step 4: Write the live contract test**

`tests/contract/live.contract.ts` — note the `.contract.ts` extension keeps it out of the default `vitest run` glob.

```ts
import { describe, it, expect } from 'vitest'
import { ItunesSource, topSongsUrl, marketingUrl } from '../../harvest/sources/itunes'

describe('LIVE: iTunes contract', () => {
  it('the genre feed still returns playable songs', async () => {
    const source = new ItunesSource({ limit: 10 })
    const songs = await source.fetchCell('us', 14)

    expect(songs.length).toBeGreaterThan(4)
    const first = songs[0]!
    expect(first.title).toBeTruthy()
    expect(first.artist).toBeTruthy()
    expect(first.preview).toMatch(/^https:\/\//)
    expect(first.art).toMatch(/^https:\/\//)
  }, 30_000)

  it('the marketing fallback feed still parses', async () => {
    const res = await fetch(marketingUrl('br', 10))
    expect(res.ok).toBe(true)
    const body = (await res.json()) as { feed?: { results?: unknown[] } }
    expect(Array.isArray(body.feed?.results)).toBe(true)
  }, 30_000)

  it('preview URLs are actually fetchable', async () => {
    const source = new ItunesSource({ limit: 5 })
    const songs = await source.fetchCell('us', 14)
    const res = await fetch(songs[0]!.preview, { method: 'HEAD' })
    expect(res.ok).toBe(true)
  }, 30_000)

  it('the genre taxonomy still contains our axis genres', async () => {
    const res = await fetch(
      'https://itunes.apple.com/WebObjects/MZStoreServices.woa/ws/genres?id=34',
    )
    const tree = (await res.json()) as Record<string, { subgenres?: Record<string, unknown> }>
    const ids = Object.keys(tree['34']?.subgenres ?? {})
    for (const required of ['14', '18', '21', '1122']) {
      expect(ids, `genre ${required} vanished from Apple's taxonomy`).toContain(required)
    }
  }, 30_000)

  it('builds the expected URL shape', () => {
    expect(topSongsUrl('us', 14, 10)).toContain('/us/rss/topsongs/limit=10/genre=14/json')
  })
})
```

Add to `package.json` scripts:
```json
"test:contract": "vitest run --config vitest.contract.config.ts"
```

`vitest.contract.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['tests/contract/**/*.contract.ts'], testTimeout: 30_000 },
})
```

- [ ] **Step 5: Run it manually**

Run: `npm run test:contract`
Expected: 5 passing against the live APIs. **Never add this to CI.**

- [ ] **Step 6: Run everything and commit**

Run: `npm test` — the contract test must NOT appear in this run.

```bash
git add src/ui/staleNotice.ts tests/staleNotice.test.ts tests/contract vitest.contract.config.ts package.json src/main.ts index.html
git commit -m "feat: add stale-data notice and live API contract tests"
```

### Task 23: Volume persistence, momentum panning, and unplayable tiles

Three remaining v1 spec requirements: §7 volume/mute persist to `localStorage`, §8 drag pans with momentum, §9 a dead preview marks its tile unplayable rather than failing silently.

**Files:**
- Create: `src/ui/volume.ts`, `src/render/momentum.ts`
- Modify: `src/audio/engine.ts`, `src/render/canvas.ts`, `src/main.ts`, `index.html`
- Test: `tests/volume.test.ts`, `tests/momentum.test.ts`

**Interfaces:**
- Consumes: `AudioEngine`, `AtlasRenderer`
- Produces:
  - `loadPrefs(): { volume: number; muted: boolean }`, `savePrefs(p: { volume: number; muted: boolean }): void`
  - `class VolumeControl` with `constructor(root: HTMLElement, engine: AudioEngine)`
  - `class Momentum` with `constructor(apply: (dx: number, dy: number) => void)`, `push(dx, dy): void`, `release(): void`, `stop(): void`
  - `AudioEngine.failed: Set<string>` — song ids whose preview would not play
  - `AudioEngine.onFailure(cb: (songId: string) => void): () => void`

- [ ] **Step 1: Write the failing tests**

`tests/volume.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { loadPrefs, savePrefs } from '../src/ui/volume'

beforeEach(() => localStorage.clear())

describe('preferences', () => {
  it('defaults to full volume, unmuted', () => {
    expect(loadPrefs()).toEqual({ volume: 1, muted: false })
  })

  it('round-trips a saved preference', () => {
    savePrefs({ volume: 0.35, muted: true })
    expect(loadPrefs()).toEqual({ volume: 0.35, muted: true })
  })

  it('clamps a corrupt volume back into range', () => {
    localStorage.setItem('lta:prefs', JSON.stringify({ volume: 99, muted: false }))
    expect(loadPrefs().volume).toBe(1)
  })

  it('falls back to defaults on unparseable JSON', () => {
    localStorage.setItem('lta:prefs', 'not json')
    expect(loadPrefs()).toEqual({ volume: 1, muted: false })
  })
})
```

`tests/momentum.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Momentum } from '../src/render/momentum'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Momentum', () => {
  it('does not glide while still being pushed', () => {
    const apply = vi.fn()
    const m = new Momentum(apply)
    m.push(10, 0)
    expect(apply).not.toHaveBeenCalled()
  })

  it('glides after release and then stops', () => {
    const apply = vi.fn()
    const m = new Momentum(apply)
    m.push(20, 10)
    m.release()

    vi.advanceTimersByTime(32)
    expect(apply).toHaveBeenCalled()

    const callsAfterGlide = apply.mock.calls.length
    vi.advanceTimersByTime(3000)
    const callsAtRest = apply.mock.calls.length
    vi.advanceTimersByTime(3000)
    expect(apply.mock.calls.length).toBe(callsAtRest)
    expect(callsAtRest).toBeGreaterThan(callsAfterGlide - 1)
  })

  it('decays toward zero rather than accelerating', () => {
    const deltas: number[] = []
    const m = new Momentum((dx) => deltas.push(Math.abs(dx)))
    m.push(50, 0)
    m.release()
    vi.advanceTimersByTime(500)

    expect(deltas.length).toBeGreaterThan(1)
    expect(deltas[deltas.length - 1]!).toBeLessThan(deltas[0]!)
  })

  it('stop() halts an in-flight glide', () => {
    const apply = vi.fn()
    const m = new Momentum(apply)
    m.push(40, 0)
    m.release()
    vi.advanceTimersByTime(32)
    m.stop()

    const calls = apply.mock.calls.length
    vi.advanceTimersByTime(2000)
    expect(apply.mock.calls.length).toBe(calls)
  })

  it('a release with no push does nothing', () => {
    const apply = vi.fn()
    new Momentum(apply).release()
    vi.advanceTimersByTime(1000)
    expect(apply).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run and watch both fail**

Run: `npx vitest run tests/volume.test.ts tests/momentum.test.ts`
Expected: FAIL — cannot resolve `../src/ui/volume` or `../src/render/momentum`.

- [ ] **Step 3: Implement `src/ui/volume.ts`**

```ts
import type { AudioEngine } from '../audio/engine'

const KEY = 'lta:prefs'

export type Prefs = { volume: number; muted: boolean }

const DEFAULTS: Prefs = { volume: 1, muted: false }

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<Prefs>
    const volume = typeof parsed.volume === 'number' ? Math.min(1, Math.max(0, parsed.volume)) : 1
    return { volume, muted: parsed.muted === true }
  } catch {
    return { ...DEFAULTS }
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // Private browsing can reject writes; preferences are not worth failing over.
  }
}

export class VolumeControl {
  constructor(root: HTMLElement, engine: AudioEngine) {
    const prefs = loadPrefs()
    engine.setVolume(prefs.volume)
    engine.setMuted(prefs.muted)

    const wrap = document.createElement('div')
    wrap.className = 'volume'

    const mute = document.createElement('button')
    mute.setAttribute('data-mute', '')
    mute.textContent = prefs.muted ? '🔇' : '🔊'
    mute.setAttribute('aria-label', 'Mute')

    const slider = document.createElement('input')
    slider.type = 'range'
    slider.min = '0'
    slider.max = '1'
    slider.step = '0.01'
    slider.value = String(prefs.volume)
    slider.setAttribute('data-volume', '')

    const persist = (): void =>
      savePrefs({ volume: Number(slider.value), muted: mute.textContent === '🔇' })

    slider.addEventListener('input', () => {
      engine.setVolume(Number(slider.value))
      persist()
    })

    mute.addEventListener('click', () => {
      const nowMuted = mute.textContent === '🔊'
      mute.textContent = nowMuted ? '🔇' : '🔊'
      engine.setMuted(nowMuted)
      persist()
    })

    wrap.append(mute, slider)
    root.appendChild(wrap)
  }
}
```

- [ ] **Step 4: Implement `src/render/momentum.ts`**

```ts
const FRAME_MS = 16
const DECAY = 0.92
const MIN_VELOCITY = 0.4

/** Carries a drag's final velocity forward with exponential decay. */
export class Momentum {
  private vx = 0
  private vy = 0
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly apply: (dx: number, dy: number) => void) {}

  /** Called on every drag move; records velocity but does not glide yet. */
  push(dx: number, dy: number): void {
    this.stop()
    this.vx = dx
    this.vy = dy
  }

  release(): void {
    if (Math.abs(this.vx) < MIN_VELOCITY && Math.abs(this.vy) < MIN_VELOCITY) return

    this.timer = setInterval(() => {
      this.vx *= DECAY
      this.vy *= DECAY

      if (Math.abs(this.vx) < MIN_VELOCITY && Math.abs(this.vy) < MIN_VELOCITY) {
        this.stop()
        return
      }
      this.apply(this.vx, this.vy)
    }, FRAME_MS)
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }
}
```

- [ ] **Step 5: Mark failed previews in `src/audio/engine.ts`**

Add a field and accessor to `AudioEngine`:

```ts
  readonly failed = new Set<string>()
  private readonly failureListeners = new Set<(songId: string) => void>()

  onFailure(cb: (songId: string) => void): () => void {
    this.failureListeners.add(cb)
    return () => this.failureListeners.delete(cb)
  }
```

and replace the `.catch` inside `start()`:

```ts
    void incoming.el.play().catch(() => {
      this.failed.add(song.id)
      incoming.song = null
      for (const cb of this.failureListeners) cb(song.id)
      this.emit()
    })
```

In `src/render/canvas.ts`, accept the failed set and dim those tiles. Add a public field:

```ts
  /** Song ids whose preview would not play; rendered visibly inert. */
  failedSongs: ReadonlySet<string> = new Set()
```

and in both `drawTile` calls, change `dim:` to:

```ts
          dim: (hasHover && !isHover) || (song !== null && this.failedSongs.has(song.id)),
```

- [ ] **Step 6: Wire everything into `src/main.ts`**

```ts
import { VolumeControl } from './ui/volume'
import { Momentum } from './render/momentum'

new VolumeControl(root, audio)

renderer.failedSongs = audio.failed
audio.onFailure(() => renderer.invalidate())

const momentum = new Momentum((dx, dy) => {
  renderer.panBy(dx, dy)
  syncMinimap()
})
```

In the desktop `onPan` handler, replace the body with:

```ts
    onPan: (dx, dy) => {
      momentum.push(dx, dy)
      renderer.panBy(dx, dy)
      syncMinimap()
    },
```

and add a `pointerup` listener next to `attachPointer` so the glide begins on release:

```ts
canvas.addEventListener('pointerup', () => momentum.release())
canvas.addEventListener('pointerdown', () => momentum.stop())
```

- [ ] **Step 7: Style the volume control in `index.html`**

```css
.volume {
  position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; border-radius: 999px;
  background: rgba(16,16,24,.9); border: 1px solid #2a2a3c;
}
.volume button { background: none; border: 0; cursor: pointer; font-size: 15px; line-height: 1; }
.volume input[type=range] { width: 90px; accent-color: #ff7a45; }
```

- [ ] **Step 8: Run tests, verify by hand, commit**

Run: `npx vitest run tests/volume.test.ts tests/momentum.test.ts`
Expected: 9 passing.

Run: `npm run dev` and confirm: the volume slider persists across a reload; a flung drag coasts and settles; muting survives a refresh.

```bash
git add src/ui/volume.ts src/render/momentum.ts src/audio/engine.ts src/render/canvas.ts src/main.ts index.html tests/volume.test.ts tests/momentum.test.ts
git commit -m "feat: persist volume, add momentum panning, mark unplayable tiles"
```

**Milestone 5 complete.** v1 is shippable and matches the spec in full: `npm run build` produces a static site deployable to Netlify, Vercel, or GitHub Pages with no server.

---

## Milestone 6 — Additional sources

Optional, additive, and independently shippable. Do these once v1 is live and you can see which cells the manifest flagged `thin`.

### Task 24: Deezer source for thin cells

**Files:**
- Create: `harvest/sources/deezer.ts`, `harvest/fixtures/deezer-chart.json`
- Modify: `harvest/run.ts`
- Test: `tests/deezer.test.ts`

**Interfaces:**
- Consumes: `TokenBucket`, `Song`, `GenreId`, `youtubeSearchUrl`
- Produces: `class DeezerSource` with `constructor(opts?: { fetcher?: Fetcher; bucket?: TokenBucket; limit?: number })` and `fetchCell(country: string, genre: GenreId): Promise<Song[]>`; `normalizeDeezer(raw: unknown, country: string, genre: GenreId): Song[]`

- [ ] **Step 1: Create `harvest/fixtures/deezer-chart.json`**

```json
{
  "data": [
    {
      "id": 3135556,
      "title": "Deezer Example Track",
      "preview": "https://cdns-preview.dzcdn.net/stream/example.mp3",
      "artist": { "name": "Deezer Example Artist" },
      "album": { "title": "Deezer Example Album", "cover_big": "https://e-cdns-images.dzcdn.net/images/cover/x/500x500-000000-80-0-0.jpg" },
      "link": "https://www.deezer.com/track/3135556"
    },
    {
      "id": 3135557,
      "title": "Second Deezer Track",
      "preview": "",
      "artist": { "name": "Nobody" },
      "album": { "title": "No Preview", "cover_big": "https://e-cdns-images.dzcdn.net/images/cover/y/500x500-000000-80-0-0.jpg" },
      "link": "https://www.deezer.com/track/3135557"
    }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

`tests/deezer.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { DeezerSource, normalizeDeezer } from '../harvest/sources/deezer'
import chart from '../harvest/fixtures/deezer-chart.json'

describe('normalizeDeezer', () => {
  it('maps tracks with a preview', () => {
    const songs = normalizeDeezer(chart, 'fr', 14)
    expect(songs).toHaveLength(1)
    expect(songs[0]!.title).toBe('Deezer Example Track')
    expect(songs[0]!.artist).toBe('Deezer Example Artist')
    expect(songs[0]!.album).toBe('Deezer Example Album')
  })

  it('marks the source and mp3 preview type', () => {
    const songs = normalizeDeezer(chart, 'fr', 14)
    expect(songs[0]!.source).toBe('deezer')
    expect(songs[0]!.previewType).toBe('mp3')
  })

  it('drops tracks with an empty preview', () => {
    expect(normalizeDeezer(chart, 'fr', 14).map((s) => s.title)).not.toContain('Second Deezer Track')
  })

  it('stamps the requested country and genre', () => {
    const songs = normalizeDeezer(chart, 'fr', 14)
    expect(songs[0]!.country).toBe('fr')
    expect(songs[0]!.genre).toBe(14)
  })

  it('builds a YouTube link', () => {
    expect(normalizeDeezer(chart, 'fr', 14)[0]!.yt).toContain('youtube.com/results')
  })

  it('returns an empty array for junk input', () => {
    expect(normalizeDeezer(null, 'fr', 14)).toEqual([])
    expect(normalizeDeezer({ data: 'nope' }, 'fr', 14)).toEqual([])
  })
})

describe('DeezerSource', () => {
  it('fetches and normalizes a cell', async () => {
    const src = new DeezerSource({ fetcher: async () => chart })
    expect(await src.fetchCell('fr', 14)).toHaveLength(1)
  })

  it('returns an empty array instead of throwing', async () => {
    const src = new DeezerSource({ fetcher: async () => { throw new Error('429') } })
    expect(await src.fetchCell('fr', 14)).toEqual([])
  })

  it('does not create ids that collide with iTunes ids', async () => {
    const src = new DeezerSource({ fetcher: async () => chart })
    const songs = await src.fetchCell('fr', 14)
    expect(songs[0]!.id).toBeTruthy()
    expect(songs[0]!.id).not.toBe('')
  })
})
```

- [ ] **Step 3: Run and watch it fail**

Run: `npx vitest run tests/deezer.test.ts`
Expected: FAIL — cannot resolve `../harvest/sources/deezer`.

- [ ] **Step 4: Implement `harvest/sources/deezer.ts`**

```ts
import { createHash } from 'node:crypto'
import { TokenBucket } from '../rateLimit'
import { youtubeSearchUrl } from '../normalize'
import type { Fetcher } from './itunes'
import type { GenreId, Song } from '../types'

type DeezerTrack = {
  id?: number
  title?: string
  preview?: string
  link?: string
  artist?: { name?: string }
  album?: { title?: string; cover_big?: string }
}

export function normalizeDeezer(raw: unknown, country: string, genre: GenreId): Song[] {
  const data = (raw as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []

  const songs: Song[] = []
  for (const item of data as DeezerTrack[]) {
    if (!item.preview || !item.id) continue

    const artist = item.artist?.name ?? ''
    const title = item.title ?? ''
    const album = item.album?.title

    songs.push({
      id: createHash('sha1').update(`deezer:${item.id}`).digest('hex').slice(0, 16),
      title,
      artist,
      ...(album ? { album } : {}),
      art: item.album?.cover_big ?? '',
      preview: item.preview,
      previewType: 'mp3',
      genre,
      country,
      source: 'deezer',
      link: item.link ?? '',
      yt: youtubeSearchUrl(artist, title),
    })
  }
  return songs
}

const defaultFetcher: Fetcher = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

export class DeezerSource {
  private readonly fetcher: Fetcher
  private readonly bucket: TokenBucket
  private readonly limit: number

  constructor(opts: { fetcher?: Fetcher; bucket?: TokenBucket; limit?: number } = {}) {
    this.fetcher = opts.fetcher ?? defaultFetcher
    // Deezer allows ~50 requests per 5 seconds.
    this.bucket = opts.bucket ?? new TokenBucket(8, 8)
    this.limit = opts.limit ?? 50
  }

  async fetchCell(country: string, genre: GenreId): Promise<Song[]> {
    await this.bucket.take()
    const url =
      `https://api.deezer.com/search?q=${encodeURIComponent(`country:"${country}"`)}` +
      `&limit=${this.limit}`
    try {
      return normalizeDeezer(await this.fetcher(url), country, genre)
    } catch {
      return []
    }
  }
}
```

- [ ] **Step 5: Merge into the runner**

In `harvest/run.ts`, change the `songs` assignment inside the loop:

```ts
songs = dedupe(await source.fetchCell(country, genre.id))

// Top up thin cells from the secondary source.
if (opts.secondary && songs.length < 20) {
  const extra = await opts.secondary.fetchCell(country, genre.id).catch(() => [])
  songs = dedupe([...songs, ...extra])
}
```

Add `secondary?: SourceLike` to `HarvestOptions`, and in the CLI entrypoint pass `secondary: new DeezerSource()`.

- [ ] **Step 6: Run tests and commit**

Run: `npx vitest run tests/deezer.test.ts`
Expected: 9 passing.

```bash
git add harvest/sources/deezer.ts harvest/fixtures/deezer-chart.json harvest/run.ts tests/deezer.test.ts
git commit -m "feat: add Deezer source to top up thin cells"
```

### Task 25: Jamendo source for the long tail

Jamendo needs a free client ID from https://devportal.jamendo.com. Its tracks are Creative Commons, so unlike the other sources they may legally be self-hosted — but we still hotlink, for consistency and bandwidth.

**Files:**
- Create: `harvest/sources/jamendo.ts`, `harvest/fixtures/jamendo-tracks.json`, `.env.example`
- Modify: `harvest/run.ts`, `.gitignore`
- Test: `tests/jamendo.test.ts`

**Interfaces:**
- Consumes: `TokenBucket`, `Song`, `GenreId`, `youtubeSearchUrl`, `Fetcher`
- Produces: `class JamendoSource` with `constructor(opts?: { clientId?: string; fetcher?: Fetcher; bucket?: TokenBucket; limit?: number })` and `fetchCell(country, genre): Promise<Song[]>`; `normalizeJamendo(raw, country, genre): Song[]`; `GENRE_TAGS: Record<GenreId, string>`

- [ ] **Step 1: Create the fixture**

`harvest/fixtures/jamendo-tracks.json`:
```json
{
  "headers": { "status": "success", "results_count": 2 },
  "results": [
    {
      "id": "1886711",
      "name": "Jamendo Example Track",
      "artist_name": "Jamendo Example Artist",
      "album_name": "Jamendo Example Album",
      "album_image": "https://usercontent.jamendo.com/example-300.jpg",
      "audio": "https://prod-1.storage.jamendo.com/?trackid=1886711&format=mp31",
      "shareurl": "https://www.jamendo.com/track/1886711"
    },
    {
      "id": "1886712",
      "name": "No Audio Track",
      "artist_name": "Nobody",
      "album_name": "Empty",
      "album_image": "https://usercontent.jamendo.com/empty-300.jpg",
      "audio": "",
      "shareurl": "https://www.jamendo.com/track/1886712"
    }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

`tests/jamendo.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { JamendoSource, normalizeJamendo, GENRE_TAGS } from '../harvest/sources/jamendo'
import tracks from '../harvest/fixtures/jamendo-tracks.json'

describe('normalizeJamendo', () => {
  it('maps tracks that have audio', () => {
    const songs = normalizeJamendo(tracks, 'us', 21)
    expect(songs).toHaveLength(1)
    expect(songs[0]!.title).toBe('Jamendo Example Track')
    expect(songs[0]!.artist).toBe('Jamendo Example Artist')
  })

  it('marks the source and mp3 type', () => {
    const songs = normalizeJamendo(tracks, 'us', 21)
    expect(songs[0]!.source).toBe('jamendo')
    expect(songs[0]!.previewType).toBe('mp3')
  })

  it('drops tracks with no audio URL', () => {
    expect(normalizeJamendo(tracks, 'us', 21).map((s) => s.title)).not.toContain('No Audio Track')
  })

  it('returns an empty array for junk', () => {
    expect(normalizeJamendo(null, 'us', 21)).toEqual([])
    expect(normalizeJamendo({ results: 'nope' }, 'us', 21)).toEqual([])
  })
})

describe('GENRE_TAGS', () => {
  it('maps our axis genres to Jamendo tags', () => {
    expect(GENRE_TAGS[21]).toBe('rock')
    expect(GENRE_TAGS[11]).toBe('jazz')
  })
})

describe('JamendoSource', () => {
  it('returns an empty array without a client id rather than throwing', async () => {
    const src = new JamendoSource({ clientId: '' })
    expect(await src.fetchCell('us', 21)).toEqual([])
  })

  it('fetches and normalizes when configured', async () => {
    const src = new JamendoSource({ clientId: 'abc', fetcher: async () => tracks })
    expect(await src.fetchCell('us', 21)).toHaveLength(1)
  })

  it('sends the client id in the query', async () => {
    const fetcher = vi.fn(async () => tracks)
    const src = new JamendoSource({ clientId: 'abc123', fetcher })
    await src.fetchCell('us', 21)
    expect(fetcher.mock.calls[0]![0]).toContain('client_id=abc123')
  })

  it('skips genres with no Jamendo tag mapping', async () => {
    const fetcher = vi.fn(async () => tracks)
    const src = new JamendoSource({ clientId: 'abc', fetcher })
    expect(await src.fetchCell('us', 99999)).toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('swallows upstream errors', async () => {
    const src = new JamendoSource({
      clientId: 'abc',
      fetcher: async () => { throw new Error('500') },
    })
    expect(await src.fetchCell('us', 21)).toEqual([])
  })
})
```

- [ ] **Step 3: Run and watch it fail**

Run: `npx vitest run tests/jamendo.test.ts`
Expected: FAIL — cannot resolve `../harvest/sources/jamendo`.

- [ ] **Step 4: Implement `harvest/sources/jamendo.ts`**

```ts
import { createHash } from 'node:crypto'
import { TokenBucket } from '../rateLimit'
import { youtubeSearchUrl } from '../normalize'
import type { Fetcher } from './itunes'
import type { GenreId, Song } from '../types'

/** Jamendo uses free-text tags, so our numeric axis genres need a mapping. */
export const GENRE_TAGS: Record<number, string> = {
  14: 'pop', 20: 'alternative', 21: 'rock', 10: 'songwriter', 1289: 'folk',
  18: 'hiphop', 15: 'soul', 24: 'reggae', 7: 'electronic', 17: 'dance',
  6: 'country', 2: 'blues', 11: 'jazz', 5: 'classical', 16: 'soundtrack',
  53: 'instrumental', 13: 'newage', 25: 'lounge', 23: 'vocal', 22: 'gospel',
  12: 'latin', 1122: 'brazilian', 1203: 'african', 1197: 'arabic',
  1300: 'turkish', 1262: 'indian', 1232: 'chinese', 1243: 'korean',
  27: 'jpop', 19: 'world',
}

type JamendoTrack = {
  id?: string
  name?: string
  artist_name?: string
  album_name?: string
  album_image?: string
  audio?: string
  shareurl?: string
}

export function normalizeJamendo(raw: unknown, country: string, genre: GenreId): Song[] {
  const results = (raw as { results?: unknown } | null)?.results
  if (!Array.isArray(results)) return []

  const songs: Song[] = []
  for (const item of results as JamendoTrack[]) {
    if (!item.audio || !item.id) continue

    const artist = item.artist_name ?? ''
    const title = item.name ?? ''

    songs.push({
      id: createHash('sha1').update(`jamendo:${item.id}`).digest('hex').slice(0, 16),
      title,
      artist,
      ...(item.album_name ? { album: item.album_name } : {}),
      art: item.album_image ?? '',
      preview: item.audio,
      previewType: 'mp3',
      genre,
      country,
      source: 'jamendo',
      link: item.shareurl ?? '',
      yt: youtubeSearchUrl(artist, title),
    })
  }
  return songs
}

const defaultFetcher: Fetcher = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

export class JamendoSource {
  private readonly clientId: string
  private readonly fetcher: Fetcher
  private readonly bucket: TokenBucket
  private readonly limit: number

  constructor(
    opts: { clientId?: string; fetcher?: Fetcher; bucket?: TokenBucket; limit?: number } = {},
  ) {
    this.clientId = opts.clientId ?? process.env['JAMENDO_CLIENT_ID'] ?? ''
    this.fetcher = opts.fetcher ?? defaultFetcher
    this.bucket = opts.bucket ?? new TokenBucket(4, 4)
    this.limit = opts.limit ?? 50
  }

  async fetchCell(country: string, genre: GenreId): Promise<Song[]> {
    if (!this.clientId) return []

    const tag = GENRE_TAGS[genre]
    if (!tag) return []

    await this.bucket.take()
    const url =
      `https://api.jamendo.com/v3.0/tracks/?client_id=${this.clientId}` +
      `&format=json&limit=${this.limit}&tags=${tag}&order=popularity_total&audioformat=mp31`

    try {
      return normalizeJamendo(await this.fetcher(url), country, genre)
    } catch {
      return []
    }
  }
}
```

- [ ] **Step 5: Add `.env.example` and gitignore real env files**

`.env.example`:
```
# Free key from https://devportal.jamendo.com — optional, only for the Jamendo source
JAMENDO_CLIENT_ID=
```

Append to `.gitignore`:
```
.env
.env.local
```

- [ ] **Step 6: Run tests and commit**

Run: `npx vitest run tests/jamendo.test.ts`
Expected: 10 passing.

```bash
git add harvest/sources/jamendo.ts harvest/fixtures/jamendo-tracks.json tests/jamendo.test.ts .env.example .gitignore
git commit -m "feat: add Jamendo source for Creative Commons long tail"
```

**Milestone 6 complete.**

---

## Deployment

The build output is fully static.

```bash
npm run harvest          # ~20-40 min for 1,200 cells; resumable
npm run build            # tsc --noEmit, then vite build → dist/
```

Deploy `dist/` to Netlify, Vercel, or GitHub Pages. There is no server, no environment variable, and no API key required at runtime — `JAMENDO_CLIENT_ID` is only ever read by the harvest.

To refresh the catalogue, re-run `npm run harvest -- --force` and redeploy. A monthly GitHub Action doing exactly that is a reasonable follow-up, and the `STALE_AFTER_DAYS` notice from Task 22 tells you when it is overdue.
