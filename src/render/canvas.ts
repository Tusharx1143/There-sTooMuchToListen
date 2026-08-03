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
