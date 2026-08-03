import { axialToPixel, offsetToAxial, pixelToAxial, axialToOffset, HEX_SIZE, type Offset, type Point } from '../atlas/hex'
import { AtlasLayout, CELL_COLS } from '../atlas/layout'
import { clampView, requiredCellKeys, visibleOffsets } from '../atlas/viewport'
import type { CellStore } from '../data/loader'
import { ImageCache, fallbackColors, speckleColor } from './imageCache'
import { drawTile, tileTier, TILE_GAP } from './tile'
import { hexPath } from './tile'
import { easeCentre, makeLens, transformTile, unlensPoint, BRIGHT_MIN, type Lens } from './lens'
import { cellKey, type Song } from '../types'

/** World-space radius around the lens whose cells we actually fetch. */
const DATA_RADIUS_PX = 120
/** Under this much distance left to travel, the lens counts as parked. */
const SETTLE_PX = 0.25
const BG = '#07070c'

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
  private focalSong: string | null = null
  private lastFrame = 0
  private readonly focalListeners = new Set<(o: Offset | null) => void>()

  private dirty = true
  private raf: number | null = null
  private readonly ctx: CanvasRenderingContext2D

  /**
   * The undistorted field, cached. Outside the lens radius both scales are
   * exactly 1 and brightness is exactly BRIGHT_MIN, so those tiles are
   * pixel-identical wherever the lens happens to be — they depend only on
   * `view`. The lens moves constantly; `view` changes only when you pan.
   */
  private field: HTMLCanvasElement | null = null
  private fieldCtx: CanvasRenderingContext2D | null = null
  private fieldKey = ''
  private fieldStale = true

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly layout: AtlasLayout,
    private readonly store: CellStore,
    private readonly images: ImageCache,
    makeCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
  ) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d canvas context unavailable')
    this.ctx = ctx

    // A missing offscreen context is survivable: we just draw every tile live.
    this.field = makeCanvas()
    this.fieldCtx = this.field.getContext('2d')
    if (!this.fieldCtx) this.field = null

    this.store.onChange(() => {
      this.invalidate()
      if (this.settled) this.updateFocal()
    })
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
    const song = next ? songAt(next, this.layout, this.store) : null
    const songId = song?.id ?? null

    // Track the song as well as the tile: the cursor often parks on a tile
    // whose cell is still in flight, and without this the arriving data would
    // never reach the listeners.
    const sameTile = next?.col === this.focalOffset?.col && next?.row === this.focalOffset?.row
    if (sameTile && songId === this.focalSong) return

    this.focalOffset = next
    this.focalSong = songId
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

    this.fieldStale = true
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

  /** Forces a synchronous frame. The rAF loop uses this; so do tests. */
  redraw(): void {
    this.draw()
  }

  private draw(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    const lens = this.lens

    // Only the lens neighbourhood gets real data. The rest of the field is
    // speckle — nobody can read a 3px tile, so fetching it would be waste.
    const focusWorld = { x: lens.cx + this.view.x, y: lens.cy + this.view.y }
    this.store.ensure(
      requiredCellKeys(
        {
          x: focusWorld.x - DATA_RADIUS_PX,
          y: focusWorld.y - DATA_RADIUS_PX,
          w: DATA_RADIUS_PX * 2,
          h: DATA_RADIUS_PX * 2,
        },
        this.layout,
      ),
    )

    const size = HEX_SIZE * TILE_GAP
    const focal = axialToOffset(pixelToAxial(focusWorld))
    const R = lens.radius

    if (this.paintField(w, h)) {
      this.ctx.drawImage(this.field!, 0, 0, w, h)
      // The cached layer also drew the tiles the lens now owns; punch them out
      // so the undistorted originals don't show through the distorted gaps.
      this.ctx.save()
      this.ctx.beginPath()
      this.ctx.arc(lens.cx, lens.cy, R, 0, Math.PI * 2)
      this.ctx.clip()
      this.ctx.fillStyle = BG
      this.ctx.fillRect(lens.cx - R, lens.cy - R, R * 2, R * 2)
      this.ctx.restore()
    } else {
      this.ctx.fillStyle = BG
      this.ctx.fillRect(0, 0, w, h)
      this.paintTiles(visibleOffsets({ x: this.view.x, y: this.view.y, w, h }, this.layout),
        lens, size, focal, w, h, false)
      return
    }

    // Only the disc is live. f(d) < D for every d < D, so the tiles that land
    // inside it are exactly those whose undistorted distance is under R.
    this.paintTiles(
      visibleOffsets(
        { x: focusWorld.x - R, y: focusWorld.y - R, w: R * 2, h: R * 2 },
        this.layout,
      ),
      lens, size, focal, w, h, true,
    )
  }

  private paintTiles(
    range: { colMin: number; colMax: number; rowMin: number; rowMax: number },
    lens: Lens,
    size: number,
    focal: Offset,
    w: number,
    h: number,
    discOnly: boolean,
  ): void {
    const r2 = lens.radius * lens.radius

    for (let row = range.rowMin; row <= range.rowMax; row++) {
      for (let col = range.colMin; col <= range.colMax; col++) {
        const p = axialToPixel(offsetToAxial({ col, row }))
        const sx = p.x - this.view.x
        const sy = p.y - this.view.y

        if (discOnly) {
          const dx = sx - lens.cx
          const dy = sy - lens.cy
          if (dx * dx + dy * dy >= r2) continue // the cached field owns this one
        }

        const t = transformTile({ x: sx, y: sy }, lens)
        const reach = size * Math.max(t.radial, t.tangential)
        if (t.x < -reach || t.x > w + reach || t.y < -reach || t.y > h + reach) continue

        const tier = tileTier(size * t.radial)
        const song = songAt({ col, row }, this.layout, this.store)

        drawTile(this.ctx, {
          x: t.x,
          y: t.y,
          size,
          angle: t.angle,
          radial: t.radial,
          tangential: t.tangential,
          alpha: t.brightness,
          // Only the art tier may touch the cache — get() starts a fetch.
          image: tier === 'art' && song ? this.images.get(song.art) : null,
          colors: song ? fallbackColors(song.id) : [speckleColor(col, row), '#0b0b12'],
          highlighted: col === focal.col && row === focal.row,
          dim: song !== null && this.failedSongs.has(song.id),
        })
      }
    }
  }

  /**
   * Repaints the cached field if `view`, the canvas size, or the loaded cells
   * have moved on. Returns false when there is no offscreen context to use.
   */
  private paintField(w: number, h: number): boolean {
    const fctx = this.fieldCtx
    const field = this.field
    if (!fctx || !field) return false

    const dpr = window.devicePixelRatio || 1
    const key = `${this.view.x}|${this.view.y}|${w}|${h}|${dpr}`
    if (!this.fieldStale && key === this.fieldKey) return true

    if (field.width !== Math.floor(w * dpr) || field.height !== Math.floor(h * dpr)) {
      field.width = Math.floor(w * dpr)
      field.height = Math.floor(h * dpr)
    }
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    fctx.fillStyle = BG
    fctx.fillRect(0, 0, w, h)

    // Every tile out here is solid-tier at scale 1 and a single shared alpha,
    // so we can skip drawTile's per-tile save/transform entirely.
    fctx.globalAlpha = BRIGHT_MIN
    const size = HEX_SIZE * TILE_GAP
    const range = visibleOffsets({ x: this.view.x, y: this.view.y, w, h }, this.layout)

    for (let row = range.rowMin; row <= range.rowMax; row++) {
      for (let col = range.colMin; col <= range.colMax; col++) {
        const p = axialToPixel(offsetToAxial({ col, row }))
        // Speckle only — deliberately never consults the store. Cells load and
        // evict as the lens roams, and letting that touch this layer would
        // invalidate it several times a second and cost more than it saves.
        // At 12% alpha, out here, the hashed hue is indistinguishable anyway.
        fctx.fillStyle = speckleColor(col, row)
        hexPath(fctx, p.x - this.view.x, p.y - this.view.y, size)
        fctx.fill()
      }
    }

    fctx.globalAlpha = 1
    this.fieldKey = key
    this.fieldStale = false
    return true
  }
}
