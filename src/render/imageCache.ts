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

/**
 * Colour for a hex with no song behind it. Most of the field is unloaded by
 * design — only the lens neighbourhood fetches cells — so the speckle is what
 * keeps the grid looking dense for free.
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
