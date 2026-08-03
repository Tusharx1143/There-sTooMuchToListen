import { axialToPixel, offsetToAxial, pixelToAxial, axialToOffset, HEX_SIZE, type Offset, type Point } from '../atlas/hex'
import { AtlasLayout, CELL_COLS } from '../atlas/layout'
import { clampView, requiredCellKeys, visibleOffsets } from '../atlas/viewport'
import type { CellStore } from '../data/loader'
import { ImageCache, fallbackColors } from './imageCache'
import { drawTile, TILE_GAP } from './tile'
import { easeCentre, makeLens, transformTile, unlensPoint, type Lens } from './lens'
import { cellKey, type Song } from '../types'

const HOVER_SCALE = 1.45
/** Under this much distance left to travel, the lens counts as parked. */
const SETTLE_PX = 0.25

/** Pure lookup: which song lives on this hex, if its cell is loaded? */
export function songAt(o: Offset, layout: AtlasLayout, store: CellStore): Song | null {
  const slot = layout.slotAt(o)
  if (!slot) return null
  const songs = store.get(cellKey(slot.country, slot.genre))
  return songs?.[slot.index] ?? null
}

export class AtlasRenderer {
  view: Point = { x: 0, y: 0 }

  /** Song ids whose preview would not play; rendered visibly inert. */
  failedSongs: ReadonlySet<string> = new Set()

  /** Where the lens is heading. Pointer sets this; touch pins it to centre. */
  lensTarget: Point = { x: 0, y: 0 }

  private centre: Point = { x: 0, y: 0 }
  private focalOffset: Offset | null = null
  private lastFrame = 0
  private readonly focalListeners = new Set<(o: Offset | null) => void>()

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

    this.lensTarget = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    this.centre = { ...this.lensTarget }
  }

  get lensCentre(): Point {
    return this.centre
  }

  get settled(): boolean {
    return (
      Math.hypot(this.lensTarget.x - this.centre.x, this.lensTarget.y - this.centre.y) <= SETTLE_PX
    )
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
    if (!this.settled) {
      this.centre = easeCentre(this.centre, this.lensTarget, dtMs)
      this.invalidate()
    }

    // Re-check rather than returning early: the ease above may have parked the
    // lens on this very frame, and the focal tile should publish immediately
    // instead of waiting for the next one.
    if (this.settled) {
      if (this.centre.x !== this.lensTarget.x || this.centre.y !== this.lensTarget.y) {
        this.centre = { ...this.lensTarget }
        this.invalidate()
      }
      this.updateFocal()
    }
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

    const clamp = (p: Point): Point => ({
      x: Math.min(Math.max(p.x, 0), window.innerWidth),
      y: Math.min(Math.max(p.y, 0), window.innerHeight),
    })
    this.lensTarget = clamp(this.lensTarget)
    this.centre = clamp(this.centre)

    this.invalidate()
  }

  /** Screen coordinates → the hex drawn under them, undoing the distortion. */
  hoverAt(clientX: number, clientY: number): Offset | null {
    const flat = unlensPoint({ x: clientX, y: clientY }, this.lens)
    const world = { x: flat.x + this.view.x, y: flat.y + this.view.y }
    const o = axialToOffset(pixelToAxial(world))
    return this.layout.slotAt(o) ? o : null
  }

  panBy(dx: number, dy: number): void {
    const rect = { x: this.view.x + dx, y: this.view.y + dy, w: window.innerWidth, h: window.innerHeight }
    this.view = clampView(rect, this.layout)
    this.invalidate()
  }

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
          dim: (hasHover && !isHover) || (song !== null && this.failedSongs.has(song.id)),
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
        dim: song !== null && this.failedSongs.has(song.id),
      })
    }
  }
}
