# Listen to Anything — Design

**Date:** 2026-08-03
**Status:** Approved, ready for implementation planning

## 1. Summary

A full-screen hex honeycomb of album art. Every tile is a song. Settle the cursor on a tile
and it swells and plays a 30-second preview. Drift sideways and the country changes; drift up
or down and the genre changes. There are no menus — you navigate by moving.

Inspired by [nothing-to-watch](https://github.com/gnovotny/nothing-to-watch), which does the
same thing for film trailers using a voronoi diagram.

### Decisions already made

| Decision | Choice | Rationale |
|---|---|---|
| Tile geometry | Hex honeycomb on a fixed lattice | ~⅓ the cost of a voronoi simulation for most of the effect; fixed coordinates let us place songs *deliberately* by genre and country |
| Navigation | Two-axis atlas: X = country, Y = genre | The only model where "every genre and country" is felt rather than configured |
| Audio source | Layered, harvested offline | iTunes primary, Deezer for gaps, Jamendo/FMA long tail, YouTube as click-through |
| Data flow | Build-time harvest → sharded static JSON | Browser makes zero API calls: free hosting, no rate limits, instant drift |
| Stack | Vite + TypeScript, no framework, canvas renderer | Thousands of tiles are too many for DOM nodes or framework reconciliation |
| Click action | Pin the song + detail card | Keeps the user inside the experience |
| v1 breadth | ~40 countries × 30 genres ≈ 60,000 songs | Feels like "everything" while staying buildable and quick to re-harvest |
| Mobile | Desktop-first, reduced touch fallback | Hover doesn't exist on touch; same data and renderer, different input layer |

### Explicitly out of scope for v1

Accounts, playlists, favourites, sharing, deep zoom into a cell, and Apple's 391 subgenres
(top-level genres only — 442 nodes is not navigable). Scaling up the country and genre counts
later is a **data change, not a code change**, because of the sharding.

## 2. Verified data foundation

These were probed live on 2026-08-03, not assumed:

- `https://itunes.apple.com/WebObjects/MZStoreServices.woa/ws/genres?id=34` → **51 top-level
  music genres, 391 subgenres** (442 nodes).
- `https://itunes.apple.com/{cc}/rss/topsongs/limit={n}/genre={id}/json` → works for arbitrary
  country×genre pairs. Each entry carries title, artist, album, artwork URL, genre label + id,
  release date, an Apple Music link, and a **30-second AAC preview URL** as an
  `<link rel="enclosure" type="audio/x-m4a">`.
- **Density probe:** 8 genres × 10 countries → **80/80 cells populated**, nearly all returning a
  full 25 entries. The atlas will not be full of holes.

### Two confirmed quirks the harvest must handle

1. **Some storefronts return degraded genre feeds.** The `kr` storefront returned exactly one
   entry for *every* genre tested — a storefront-level quirk, not a genre-level one. The harvest
   therefore runs a per-storefront health check and falls back to
   `https://rss.applemarketingtools.com/api/v2/{cc}/music/most-played/{n}/songs.json`
   (verified working) for degraded storefronts.
2. **Genre labels are localized.** The Brazilian feed titles itself "Top músicas em Brazilian".
   Axis labels must come from a fixed English taxonomy keyed by genre **id**, never from feed text.

### Why not YouTube for hover audio

Recorded so it is not revisited: YouTube Data API v3 allows 10,000 quota units/day and
`search.list` costs 100 units — 100 searches/day, against a need of tens of thousands. Playback
must go through the official iframe player per its terms; extracting or proxying audio streams
is prohibited. And an iframe takes 1–2 s to spin up, which destroys hover-to-play. YouTube is
therefore used only as an ordinary outbound link for the full song, which is free and unlimited.

## 3. Architecture

Two halves separated by a hard file boundary:

```
harvest/       Node + TS. Runs offline. Talks to Apple / Deezer / Jamendo.
                   ↓ writes versioned JSON
public/data/   The contract: sharded per-cell files + one manifest.
                   ↓ read-only
src/           Browser app. Never talks to a music API. Only reads public/data/.
```

**The browser making zero API calls is the load-bearing decision.** It is what makes the site
free to host, immune to rate limits, and instant while drifting. Every source-specific quirk is
absorbed at harvest time and never reaches the client.

Nothing is re-hosted: artwork and audio stream from the providers' own CDNs, which is what these
public APIs are for.

### Module boundaries

Each source module exposes exactly one function:

```ts
fetchCell(country: string, genre: GenreId): Promise<RawSong[]>
```

Adding Deezer or Jamendo touches nothing outside its own file. This is the primary extension point.

**Source implementation order.** All four sources are in scope. They are built in sequence
because each is independently additive, and the pipeline must be proven end-to-end before
breadth is added:

1. **iTunes** + the marketing-RSS fallback for degraded storefronts. This alone fills the atlas
   (§2 density probe: 80/80 cells) and proves harvest → shard → render → play works.
2. **YouTube click-through** — pure URL construction from artist + title. No API, no quota.
3. **Deezer** — merged in via `dedupe.ts` to fill cells the manifest flagged `thin`.
4. **Jamendo/FMA** — CC-licensed long tail for genres the majors under-serve.

A milestone is shippable after any of these steps.

```
harvest/
  sources/itunes.ts      fetchCell + genre tree + storefront health check
  sources/deezer.ts      fetchCell (gap filler)
  sources/jamendo.ts     fetchCell (CC long tail)
  normalize.ts           RawSong (any source) → Song
  dedupe.ts              collapse the same song across sources
  atlas.ts               assign songs to hex coordinates; build axis ordering
  emit.ts                write sharded cells + manifest
  fixtures/              recorded API responses for tests
src/
  main.ts
  atlas/  hex.ts  layout.ts  viewport.ts
  render/ canvas.ts  imageCache.ts  tile.ts
  audio/  engine.ts  unlock.ts
  data/   loader.ts  manifest.ts
  ui/     nowPlaying.ts  minimap.ts  search.ts  axisLabels.ts
public/data/  cells/*.json  manifest.json
tests/
```

Each file has one job and stays small enough to hold in context at once.

## 4. Data model

```ts
type GenreId = number   // Apple's numeric music genre id, e.g. 14 = Pop

type Song = {
  id: string          // stable hash of source + sourceId; survives re-harvests
  title: string
  artist: string
  album?: string
  art: string         // provider CDN, 170px (upgradeable via URL munging)
  preview: string     // 30s audio, provider CDN
  previewType: 'aac' | 'mp3'
  genre: GenreId      // canonical English id — never the localized feed label
  country: string     // ISO 3166-1 alpha-2 storefront
  source: 'itunes' | 'deezer' | 'jamendo'
  link: string        // provider page
  yt: string          // YouTube search URL for the full track
}
```

**Cell** — one country×genre pair, ~50 songs → `public/data/cells/{cc}-{genreId}.json` (~12 KB).

**Manifest** — `public/data/manifest.json`:

```ts
type Manifest = {
  schemaVersion: number
  harvestedAt: string          // ISO timestamp
  countries: string[]          // ordered left→right, grouped by region
  genres: { id: GenreId; label: string }[]  // ordered top→bottom, grouped by family
  cells: Record<string, { count: number; thin?: boolean }>  // key: "{cc}-{genreId}"
}
```

Cells absent from `cells` do not exist; the atlas closes the gap rather than rendering a hole.

## 5. The atlas

Axial hex coordinates `(q, r)`. Each cell owns a contiguous block of **5 wide × 10 tall = 50
hexes**, one song per hex.

- **q (horizontal) = country**, ordered so neighbours are culturally adjacent — a Latin American
  block, a West African block, an East Asian block, a Nordic block. Drifting sideways should feel
  like travelling, not like reading an alphabetical list.
- **r (vertical) = genre**, ordered by family so all electronic styles sit together, all rock
  styles sit together, and so on.

At v1 breadth the atlas is 200 hexes wide × 300 hexes tall = 60,000 hexes.

Pixel→hex conversion is closed-form axial math — no iteration, no spatial index needed for
hit-testing.

**Loading rule:** the viewport computes which cells it intersects, loads those plus a one-cell
prefetch ring, and evicts cells beyond that ring. The user never waits for data they are about
to reach.

## 6. Renderer

A single `<canvas>` with a 2D context, DPR-aware. WebGL is not needed at this tile count and
would add significant complexity.

- Redraw only when dirty — pan, hover change, or an animation in flight. No permanent
  `requestAnimationFrame` burn.
- Only visible hexes are drawn (~200–400 at a time), not all 60,000.
- `ImageCache`: LRU capped at ~600 decoded images, using `Image.decode()` to avoid jank on first
  paint. Off-screen artwork is evicted.
- Missing artwork falls back to a gradient derived from a hash of the song id, so the map never
  shows broken-image boxes.
- The hovered hex renders scaled up with a bright ring; immediate neighbours dim slightly.

## 7. Audio engine

Exactly **two** `<audio>` elements — `current` and `next` — crossfaded on a ~250 ms volume ramp.
A pool of many elements is unnecessary and makes state hard to reason about.

Two details carry the entire feel of the product:

1. **~180 ms hover debounce.** The cursor must *settle* on a tile, not merely sweep across it.
   Without this, crossing the screen fires dozens of audio loads. This constant will be tuned by
   hand against the real thing.
2. **Autoplay unlock.** Browsers block audio until a user gesture, so the site opens on a
   "click anywhere to listen" overlay. That single gesture unlocks audio for the session.

Volume and mute persist to `localStorage`.

## 8. Interaction and UI

- **Drift** — cursor movement pans; the tile under the cursor plays after the debounce.
- **Drag** — click-drag pans the atlas with momentum.
- **Click a tile** — *pins* it. The song keeps playing while exploration continues (hovering no
  longer steals audio until unpinned) and a detail card opens with artwork, artist, album, and
  outbound links: YouTube for the full song, Apple/Deezer for the store page.
- **Axis HUD** — the current country and genre are always displayed, updating as you drift.
- **Minimap** — small overview with a viewport rectangle; click to jump.
- **Search** — fuzzy "jump to" for a country or a genre, for when drifting is too slow.

### Mobile fallback

Hover does not exist on touch, so the core interaction cannot survive unchanged. Phones get the
same data and the same renderer with a different input layer: drag to pan, tap a tile to play.
Full touch parity (momentum panning with a centre-screen playhead) is a possible v2.

## 9. Error handling

Third-party dependencies make this a first-class concern, not a `try/catch`.

**Harvest time**

- Idempotent and resumable — writes each cell as it completes, so a crash at cell 700 of 1,200
  loses nothing.
- A shared token bucket per source keeps requests politely under rate limits.
- A cell returning fewer than 5 songs is flagged `thin` in the manifest, not treated as fatal.
- A cell that fails entirely is omitted from the manifest and the atlas closes the gap.
- Degraded storefronts (see §2) fall back to the marketing RSS feed automatically.

**Runtime**

- Dead preview URL → the tile marks itself unplayable and stays silent. No auto-advance; that is
  disorienting.
- Missing artwork → generated gradient fallback (§6).
- Cell fetch failure → one retry, then those hexes render inert. The atlas stays navigable.
- Stale dataset → `harvestedAt` past a threshold surfaces a quiet footer note.

## 10. Testing

- **Unit** — `normalize` and `dedupe` against checked-in fixtures in `harvest/fixtures/`.
  No network access in CI.
- **Property** — pixel→hex→pixel round-trips; every hex assigned exactly once; no two songs
  share a hex; cell blocks tile the plane without overlap.
- **Audio** — against a fake audio element (no real playback in CI). Asserts that a hover storm
  produces exactly one `play()`, and that crossfades sequence correctly.
- **Smoke (Playwright)** — load, unlock audio, hover a tile, assert an audio element received a
  src and `play()` was called; drift and assert new cells loaded.
- **Live contract test** — run nightly and manually, **never in CI**. Hits the real APIs and
  asserts response shapes still match the normalizers. This is how we learn Apple changed the
  feed before users do.

## 11. Repository housekeeping

`D:\Projects\Listen to anything` is currently an empty IntelliJ **Kotlin** scaffold — `src/` is
empty, and only `.idea/` and `Listen to anything.iml` exist. It is **not a git repository**.

Implementation must therefore begin by removing the Kotlin scaffold (`.idea/`, `.iml`, empty
`src/`) and initializing the project as Vite + TypeScript. `.superpowers/` has already been added
to `.gitignore`.

## 12. Open risks

| Risk | Mitigation |
|---|---|
| Apple changes or retires the legacy RSS feed | Live contract test catches it; the marketing RSS fallback already exists in the harvest; sources are pluggable |
| Preview URLs rot between harvests | Runtime error handling degrades gracefully per tile; re-harvest refreshes them |
| Atlas is large enough to get lost in | Axis HUD, minimap, and search are v1 scope, not v2 |
| Hover debounce feels wrong at 180 ms | Tuned by hand against the real build; it is a single constant |

## Appendix A — v1 axis definitions

These are the concrete v1 axes. Both lists are data, not code: extending them re-runs the
harvest and widens the atlas without touching the renderer.

### Genres (vertical axis, 30) — ordered by family

Non-music Apple genres (Comedy, Karaoke, Spoken Word, Fitness, Holiday) are excluded.

| Family | Genres (id) |
|---|---|
| Popular | Pop (14), Alternative (20), Rock (21), Singer/Songwriter (10), Folk (1289) |
| Urban | Hip-Hop/Rap (18), R&B/Soul (15), Reggae (24) |
| Electronic | Electronic (7), Dance (17) |
| Roots | Country (6), Blues (2), Jazz (11) |
| Classical & instrumental | Classical (5), Soundtrack (16), Instrumental (53), New Age (13), Easy Listening (25), Vocal (23) |
| Faith | Christian (22) |
| Regional | Latin (12), Brazilian (1122), African (1203), Arabic (1197), Turkish (1300), Indian (1262), Chinese (1232), Korean (1243), J-Pop (27), Worldwide (19) |

### Countries (horizontal axis, 40) — ordered west→east, grouped by region

| Region | Storefronts |
|---|---|
| Americas | US, CA, MX, CO, PE, CL, AR, BR |
| Western Europe | PT, ES, IE, GB, FR, NL, DE, IT |
| Nordics | DK, NO, SE, FI |
| Eastern Europe | PL, TR, RU |
| Middle East & Africa | SA, AE, EG, NG, KE, ZA |
| Asia | IN, TH, VN, ID, PH, CN, TW, KR, JP |
| Oceania | AU, NZ |

40 countries × 30 genres = **1,200 cells**; at 50 songs per cell, **60,000 songs**, matching the
200 × 300 hex atlas in §5.

Ordering is deliberate: adjacent columns are regional neighbours and adjacent rows are related
styles, so drifting in either axis produces a gradual change rather than a jump.
