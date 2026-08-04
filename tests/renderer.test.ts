import { describe, it, expect, vi } from 'vitest'
import { AtlasLayout } from '../src/atlas/layout'
import { CellStore } from '../src/data/loader'
import { requiredCellKeys } from '../src/atlas/viewport'
import { songAt, AtlasRenderer } from '../src/render/canvas'
import { ImageCache, IMAGE_CACHE_CAPACITY } from '../src/render/imageCache'
import { axialToPixel, offsetToAxial, type Offset } from '../src/atlas/hex'
import { makeLens, transformTile } from '../src/render/lens'
import type { Song } from '../src/types'

function stubCanvas(): HTMLCanvasElement {
  const ctx = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'createLinearGradient') return () => ({ addColorStop: () => {} })
      return () => {}
    },
    set: () => true,
  })
  return { width: 0, height: 0, style: {}, getContext: () => ctx } as unknown as HTMLCanvasElement
}

function stubImages(): ImageCache {
  return new ImageCache({
    make: () => ({ crossOrigin: '', src: '', decode: async () => {} } as unknown as HTMLImageElement),
  })
}

function emptyStore(): CellStore {
  const fetcher = (async () => ({ ok: true, status: 200, json: async () => [] })) as unknown as typeof fetch
  return new CellStore({ fetcher })
}

function makeRenderer(): AtlasRenderer {
  return new AtlasRenderer(stubCanvas(), new AtlasLayout(['us', 'br'], [14, 21]), emptyStore(), stubImages())
}

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
    for (const [col, row] of [[3, 4], [5, 8], [7, 12]] as const) {
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

describe('AtlasRenderer.draw', () => {
  it('requests art for every tile it draws, and stays inside the cache', async () => {
    const requested: string[] = []
    const images = {
      get: (url: string) => { requested.push(url); return null },
      onLoad: () => () => {},
    } as unknown as ImageCache

    const store = new CellStore({
      fetcher: (async () => ({ ok: true, status: 200, json: async () => songs(50) })) as unknown as typeof fetch,
    })
    const r = new AtlasRenderer(
      stubCanvas(), new AtlasLayout(['us', 'br'], [14, 21]), store, images,
    )

    r.lensTarget = { x: 100, y: 100 }
    r.step(5000)
    r.redraw()                                     // asks for the cells
    await vi.waitFor(() => expect(store.status('us-14')).toBe('ready'))
    r.redraw()                                     // now the songs are there

    // Every visible tile carries a cover, so this tracks the screenful — the
    // ceiling that matters is the image cache, not a lens-sized handful.
    expect(requested.length).toBeGreaterThan(0)
    expect(new Set(requested).size).toBeLessThan(IMAGE_CACHE_CAPACITY)
  })

  it('loads every cell the viewport covers, not just the lens neighbourhood', () => {
    const countries = Array.from({ length: 40 }, (_, i) => `c${i}`)
    const genres = Array.from({ length: 30 }, (_, i) => i + 1)
    const big = new AtlasLayout(countries, genres)

    const asked: string[][] = []
    const store = emptyStore()
    const original = store.ensure.bind(store)
    store.ensure = (keys: string[]): void => { asked.push(keys); original(keys) }

    const r = new AtlasRenderer(stubCanvas(), big, store, stubImages())
    r.redraw()

    const viewportScoped = requiredCellKeys(
      { x: r.view.x, y: r.view.y, w: window.innerWidth, h: window.innerHeight },
      big,
    )

    expect(asked).toHaveLength(1)
    // Anything short of this leaves visible tiles with no cover to draw.
    expect(new Set(asked[0])).toEqual(new Set(viewportScoped))
  })
})

describe('focal republication', () => {
  it('re-emits when the focal cell finishes loading under a still cursor', async () => {
    const fetcher = (async () => ({ ok: true, status: 200, json: async () => songs(50) })) as unknown as typeof fetch
    const store = new CellStore({ fetcher })
    const r = new AtlasRenderer(
      stubCanvas(), new AtlasLayout(['us', 'br'], [14, 21]), store, stubImages(),
    )

    const seen: (Offset | null)[] = []
    r.onFocalChange((o) => seen.push(o))

    // Park the lens over a tile whose cell has not been fetched yet.
    r.lensTarget = { x: 40, y: 40 }
    r.step(5000)
    const before = seen.length
    expect(r.focal).not.toBeNull()

    // draw() asks for the cells; the cursor never moves again.
    r.redraw()
    await vi.waitFor(() => expect(store.status('us-14')).toBe('ready'))

    expect(seen.length).toBeGreaterThan(before)
  })
})

function countingCanvas(): { canvas: HTMLCanvasElement; counts: Record<string, number>; reset: () => void } {
  const counts: Record<string, number> = {}
  const ctx = new Proxy({}, {
    get: (_t, prop) => {
      const name = String(prop)
      if (name === 'createLinearGradient') return () => ({ addColorStop: () => {} })
      return (...a: unknown[]) => { counts[name] = (counts[name] ?? 0) + 1; return undefined }
    },
    set: () => true,
  })
  const canvas = { width: 0, height: 0, style: {}, getContext: () => ctx } as unknown as HTMLCanvasElement
  return { canvas, counts, reset: () => { for (const k in counts) delete counts[k] } }
}

function bigLayout(): AtlasLayout {
  return new AtlasLayout(
    Array.from({ length: 40 }, (_, i) => `c${i}`),
    Array.from({ length: 30 }, (_, i) => i + 1),
  )
}

describe('offscreen field cache', () => {
  const realW = window.innerWidth
  const realH = window.innerHeight

  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1920, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 1080, configurable: true })
  })

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: realW, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: realH, configurable: true })
  })

  it('repaints only the lens disc when the lens moves', () => {
    const main = countingCanvas()
    const field = countingCanvas()
    const r = new AtlasRenderer(main.canvas, bigLayout(), emptyStore(), stubImages(), () => field.canvas)

    r.redraw()
    // Every tile in the field is an art tile, so clips count them.
    const fullFieldTiles = field.counts.clip ?? 0
    expect(fullFieldTiles).toBeGreaterThan(200)

    main.reset()
    field.reset()

    r.lensTarget = { x: 700, y: 500 }
    r.step(5000)
    r.redraw()

    // The field is untouched, and the live pass covers only the disc.
    expect(field.counts.clip ?? 0).toBe(0)
    expect(main.counts.drawImage ?? 0).toBe(1)
    expect(main.counts.clip ?? 0).toBeLessThan(fullFieldTiles / 3)
  })

  it('repaints the field when the view pans', () => {
    const main = countingCanvas()
    const field = countingCanvas()
    const r = new AtlasRenderer(main.canvas, bigLayout(), emptyStore(), stubImages(), () => field.canvas)

    r.redraw()
    field.reset()

    r.panBy(240, 160)
    r.redraw()

    expect(field.counts.clip ?? 0).toBeGreaterThan(200)
  })

  it('falls back to drawing every tile live without an offscreen context', () => {
    const main = countingCanvas()
    const noCtx = { width: 0, height: 0, style: {}, getContext: () => null } as unknown as HTMLCanvasElement
    const r = new AtlasRenderer(main.canvas, bigLayout(), emptyStore(), stubImages(), () => noCtx)

    r.redraw()

    expect(main.counts.drawImage ?? 0).toBe(0)
    expect(main.counts.clip ?? 0).toBeGreaterThan(200)
  })

  it('repaints the field when cells load', async () => {
    const main = countingCanvas()
    const field = countingCanvas()
    const fetcher = (async () => ({ ok: true, status: 200, json: async () => songs(50) })) as unknown as typeof fetch
    const store = new CellStore({ fetcher })
    const r = new AtlasRenderer(main.canvas, bigLayout(), store, stubImages(), () => field.canvas)

    const loaded = new Promise<void>((res) => {
      const off = store.onChange(() => { off(); res() })
    })
    r.redraw()
    await loaded
    field.reset()

    // The undistorted field draws real covers, so arriving cells change it and
    // the cached layer has to be redrawn — the frame loop's dirty flag is what
    // keeps a burst of arrivals down to one repass per frame.
    r.redraw()
    expect(field.counts.clip ?? 0).toBeGreaterThan(200)
  })
})
