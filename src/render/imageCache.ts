/**
 * Every visible tile is an art tile now, so the resident set is roughly a
 * screenful of covers rather than the lens neighbourhood. Sized to hold that
 * plus a pan's worth of history: if it ever falls below the visible count,
 * a single field repaint evicts entries it is still drawing and re-requests
 * them on the next one, forever.
 */
export const IMAGE_CACHE_CAPACITY = 1000

/**
 * Covers are harvested at 600x600. Decoded, that is 1.4 MB each — a screenful
 * would be most of a gigabyte — and no tile is ever drawn near that size, so
 * each one is rescaled once on arrival and the source bitmap is dropped.
 */
export const ART_TEXTURE_PX = 256

type Entry =
  | { status: 'loading'; img: HTMLImageElement }
  | { status: 'ready'; texture: CanvasImageSource }
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

  /** Returns the drawable texture, or null while loading / after failure. */
  get(url: string): CanvasImageSource | null {
    const existing = this.entries.get(url)

    if (existing) {
      // Touch for LRU.
      this.entries.delete(url)
      this.entries.set(url, existing)
      return existing.status === 'ready' ? existing.texture : null
    }

    const img = this.make()
    img.crossOrigin = 'anonymous'
    img.src = url
    this.entries.set(url, { status: 'loading', img })
    this.evict()

    void img
      .decode()
      .then(() => {
        if (this.entries.has(url)) {
          this.entries.set(url, { status: 'ready', texture: rescale(img) })
        }
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

/**
 * Redraws a cover at ART_TEXTURE_PX so the full-size bitmap can be collected.
 * Falls back to the source image wherever there is no 2D context to draw into
 * — headless test runs, mainly — since the only thing lost is the saving.
 */
let canRescale: boolean | null = null

function rescale(img: HTMLImageElement): CanvasImageSource {
  if (canRescale === false) return img
  try {
    const c = document.createElement('canvas')
    c.width = ART_TEXTURE_PX
    c.height = ART_TEXTURE_PX
    const ctx = c.getContext('2d')
    // Probed once, not per cover: a stubbed-out canvas complains every call.
    canRescale = ctx !== null
    if (!ctx) return img
    ctx.drawImage(img, 0, 0, ART_TEXTURE_PX, ART_TEXTURE_PX)
    return c
  } catch {
    canRescale = false
    return img
  }
}

/**
 * Colour for a hex whose cell has not arrived yet, and for the gaps past the
 * end of a short cell. Keeps the grid looking populated while the covers load.
 */
export function speckleColor(col: number, row: number): string {
  // Distinct multipliers per axis, so (2,11) and (11,2) don't land on the same
  // hue and stripe the field diagonally. Integer maths only — this runs for
  // every tile of every frame, and a template string per tile would show up.
  let h = Math.imul(col, 0x27d4eb2d) ^ Math.imul(row + 0x165667b1, 0x85ebca6b)
  h ^= h >>> 15
  return `hsl(${Math.abs(h) % 360}, 38%, 22%)`
}

/** Deterministic two-tone gradient so a missing cover never shows a broken box. */
export function fallbackColors(id: string): [string, string] {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0

  const hue = Math.abs(hash) % 360
  return [`hsl(${hue}, 45%, 32%)`, `hsl(${(hue + 40) % 360}, 40%, 12%)`]
}
