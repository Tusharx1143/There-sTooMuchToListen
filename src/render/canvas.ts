import { axialToPixel, offsetToAxial, pixelToAxial, axialToOffset, type Offset, type Point } from '../atlas/hex'
import { AtlasLayout, CELL_COLS } from '../atlas/layout'
import { clampView, requiredCellKeys, visibleOffsets } from '../atlas/viewport'
import type { CellStore } from '../data/loader'
import { ImageCache, fallbackColors, speckleColor } from './imageCache'
import { drawTile, tileTier, TILE_GAP } from './tile'
import { easeCentre, makeLens, transformTile, unlensPoint, type Lens } from './lens'
import { SettingsStore } from '../state/settings'
import { PALETTES, type Palette } from '../state/theme'
import { cellKey, type Song } from '../types'

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
   * `view` and on the data behind it. The lens moves every frame; neither of
   * those does, so this layer survives most frames untouched.
   */
  private field: HTMLCanvasElement | null = null
  private fieldCtx: CanvasRenderingContext2D | null = null
  private fieldKey = ''
  private fieldStale = true

  /** Repainted colours, swapped wholesale when the theme changes. */
  palette: Palette = PALETTES.dark

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly layout: AtlasLayout,
    private readonly store: CellStore,
    private readonly images: ImageCache,
    makeCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
    private readonly settings: SettingsStore = new SettingsStore(),
  ) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d canvas context unavailable')
    this.ctx = ctx
    this.layout.hexSize = this.settings.hexSize

    // A missing offscreen context is survivable: we just draw every tile live.
    this.field = makeCanvas()
    this.fieldCtx = this.field.getContext('2d')
    if (!this.fieldCtx) this.field = null

    // Both of these change what the undistorted field looks like now that it
    // carries real covers, so they have to reach the cached layer too.
    this.store.onChange(() => {
      this.invalidateField()
      if (this.settled) this.updateFocal()
    })
    this.images.onLoad(() => this.invalidateField())

    this.settings.onChange((_s, changed) => {
      // Tile size rewrites every world coordinate, so the view has to be
      // re-clamped against the atlas's new dimensions before the next frame.
      if (changed === 'tileSize') this.setHexSize(this.settings.hexSize)
      else if (changed === 'lens' || changed === 'fieldLight') this.invalidateField()
    })

    this.resize()

    this.lensTarget = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    this.centre = { ...this.lensTarget }
  }

  /** Swaps the render palette and repaints everything in the new colours. */
  setPalette(p: Palette): void {
    this.palette = p
    this.invalidateField()
  }

  /**
   * Keeps the world point under the lens centre fixed across the resize, so
   * changing tile size zooms about what you were looking at rather than
   * throwing you to a different corner of the atlas.
   */
  private setHexSize(next: number): void {
    const previous = this.layout.hexSize
    if (next === previous) return

    const anchor = { x: this.centre.x + this.view.x, y: this.centre.y + this.view.y }
    const scale = next / previous
    this.layout.hexSize = next

    this.view = clampView(
      {
        x: anchor.x * scale - this.centre.x,
        y: anchor.y * scale - this.centre.y,
        w: window.innerWidth,
        h: window.innerHeight,
      },
      this.layout,
    )
    this.invalidateField()
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
    return makeLens(
      this.centre.x,
      this.centre.y,
      this.settings.lensK,
      this.settings.current.fieldLight,
    )
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
    const o = axialToOffset(pixelToAxial(world, this.layout.hexSize))
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

  /** Invalidate the cached field as well — for anything that changes a tile. */
  invalidateField(): void {
    this.fieldStale = true
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
    const o = axialToOffset(pixelToAxial(world, this.layout.hexSize))
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

    // Every visible tile shows its own cover, so every visible cell has to be
    // on hand — not just the lens neighbourhood. A screenful is a few dozen
    // cells, and `ensure` drops whatever panned off.
    const focusWorld = { x: lens.cx + this.view.x, y: lens.cy + this.view.y }
    this.store.ensure(
      requiredCellKeys({ x: this.view.x, y: this.view.y, w, h }, this.layout),
    )

    const size = this.layout.hexSize * TILE_GAP
    const focal = axialToOffset(pixelToAxial(focusWorld, this.layout.hexSize))
    const R = lens.radius

    if (this.paintField(w, h)) {
      this.ctx.drawImage(this.field!, 0, 0, w, h)
      // The cached layer also drew the tiles the lens now owns; punch them out
      // so the undistorted originals don't show through the distorted gaps.
      this.ctx.save()
      this.ctx.beginPath()
      this.ctx.arc(lens.cx, lens.cy, R, 0, Math.PI * 2)
      this.ctx.clip()
      this.ctx.fillStyle = this.palette.bg
      this.ctx.fillRect(lens.cx - R, lens.cy - R, R * 2, R * 2)
      this.ctx.restore()
    } else {
      this.ctx.fillStyle = this.palette.bg
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
        const p = axialToPixel(offsetToAxial({ col, row }), this.layout.hexSize)
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
          wash: this.palette.recede === 'wash' ? this.palette.bg : null,
          // Only the art tier may touch the cache — get() starts a fetch.
          image: tier === 'art' && song ? this.images.get(song.art) : null,
          colors: song
            ? fallbackColors(song.id)
            : [speckleColor(col, row, this.palette.speckleLightness), this.palette.gap],
          highlighted: col === focal.col && row === focal.row,
          dim: song !== null && this.failedSongs.has(song.id),
          highlightColor: this.palette.highlight,
        })
      }
    }
  }

  /**
   * Repaints the cached field if `view`, the canvas size, or the data behind
   * it have moved on. Returns false when there is no offscreen context to use.
   *
   * Repaints are coalesced by the frame loop's dirty flag, so the burst of
   * arriving covers costs at most one full repass per frame however many land.
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
    fctx.fillStyle = this.palette.bg
    fctx.fillRect(0, 0, w, h)

    const size = this.layout.hexSize * TILE_GAP
    // Out here every tile is at scale 1, so the tier is the same for all of
    // them and the lookup lifts out of the loop.
    const tier = tileTier(size)
    const range = visibleOffsets({ x: this.view.x, y: this.view.y, w, h }, this.layout)

    for (let row = range.rowMin; row <= range.rowMax; row++) {
      for (let col = range.colMin; col <= range.colMax; col++) {
        const p = axialToPixel(offsetToAxial({ col, row }), this.layout.hexSize)
        const song = songAt({ col, row }, this.layout, this.store)

        drawTile(fctx, {
          x: p.x - this.view.x,
          y: p.y - this.view.y,
          size,
          angle: 0,
          radial: 1,
          tangential: 1,
          alpha: this.settings.current.fieldLight,
          wash: this.palette.recede === 'wash' ? this.palette.bg : null,
          image: tier === 'art' && song ? this.images.get(song.art) : null,
          colors: song
            ? fallbackColors(song.id)
            : [speckleColor(col, row, this.palette.speckleLightness), this.palette.gap],
          highlighted: false,
          dim: song !== null && this.failedSongs.has(song.id),
          highlightColor: this.palette.highlight,
        })
      }
    }

    this.fieldKey = key
    this.fieldStale = false
    return true
  }
}
