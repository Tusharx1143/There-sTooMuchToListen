# Listen to Anything

A full-screen honeycomb of album art you explore by moving your cursor. Rest on a
tile and it plays a 30-second preview. Horizontal position is **country**, vertical
position is **genre** — so drifting across the map is drifting across the world's
music, one hex at a time.

## How it works

- **Hover to listen.** Settle the cursor on a tile and a 30-second preview
  crossfades in. Sweep across the grid quickly and nothing plays until you stop —
  a short debounce keeps the experience calm instead of chaotic.
- **Drag to travel.** The atlas spans 40 countries × 30 genres = 1,200 cells,
  60,000+ songs. Pan freely; tiles stream in as you go.
- **Click to pin.** Lock a song in place so it keeps playing while you keep
  browsing. A detail card shows the title, artist, album art, and links out to the
  full track.
- **Search and minimap.** Jump straight to a country or genre by name, or use the
  minimap to see where you are in the whole atlas and click to teleport.
- **Touch-friendly.** On phones and tablets, drag to pan and tap to play — the
  same atlas, a different input model.

## Under the hood

- **Rendering:** a single `<canvas>` with a dirty-flag `requestAnimationFrame`
  loop draws only the hexes currently on screen, an LRU cache keeps recently-seen
  album art in memory, and tiles with no artwork yet show a deterministic
  gradient instead of a blank box.
- **Audio:** two `<audio>` elements crossfade into and out of each other, so
  changing songs never pops or cuts abruptly.
- **Data:** an offline harvest walks every (country, genre) cell against public
  music APIs and writes small static JSON shards — the browser itself never calls
  a music API directly, it only ever reads its own pre-built data files. The
  harvest is resumable and tolerates individual cells failing without losing the
  rest of the run.

## Tech stack

Vite 5, TypeScript 5 (strict mode, no `any`), Vitest for unit tests, and plain
DOM + Canvas 2D — no UI framework.

## Getting started

```bash
npm install

# Build the local song catalogue (writes to public/data/, takes a while for the
# full 1,200-cell atlas; safe to interrupt and resume)
npm run harvest

# Start the dev server
npm run dev

# Run the test suite
npm test
```

## Project layout

```
harvest/        Node-only data harvester — never imported by the browser code
src/
  atlas/        Hex-grid coordinate math and layout
  audio/        Crossfading playback engine + autoplay unlock
  data/         Manifest and per-cell data loading
  input/        Pointer and touch handling
  render/       Canvas renderer, tile drawing, image cache
  ui/           Axis readout, now-playing card, minimap, search
public/data/    Generated song data (not checked in)
tests/          Unit and integration tests
```
