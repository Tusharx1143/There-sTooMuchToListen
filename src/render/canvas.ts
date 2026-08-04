import { axialToPixel, offsetToAxial, pixelToAxial, axialToOffset, type Offset, type Point } from '../atlas/hex'
import { AtlasLayout, CELL_COLS } from '../atlas/layout'
import { clampView, requiredCellKeys, visibleOffsets } from '../atlas/viewport'
import type { CellStore } from '../data/loader'
import { ImageCache, fallbackColors, speckleColor } from './imageCache'
import { drawTile, reliefAt, tileTier, TILE_GAP } from './tile'
import {
  easeCentre,
  easeScalar,
  makeLens,
  softenK,
  transformTile,
  unlensPoint,
  LENS_MAX_SPEED_PINNED,
  LENS_MAX_SPEED_PX_PER_MS,
  LENS_TAU_MS,
  LENS_TAU_PINNED_MS,
  type Lens,
} from './lens'
import { RELIEF_PINNED_FACTOR, SettingsStore } from '../state/settings'
import { PALETTES, type Palette } from '../state/theme'
import { cellKey, type Song } from '../types'

/** Under this much distance left to travel, the lens counts as parked. */
const SETTLE_PX = 0.25

/**
 * Where a tile is drawn on screen, and how far its magnified art reaches from
 * that centre. What the now-playing card needs in order to sit beside the hex
 * it belongs to rather than in a fixed corner.
 */
export type TileAnchor = { x: number; y: number; clear: number }

/**
 * Intro reveal. The reference opens on a coarse lattice
 * (targetCellSizeViewportPercentage 0.075) and swaps to the dense one, letting
 * its force simulation settle the cells outward. We have no simulation, so the
 * same effect is an explicit tween: tiles start this many times their final
 * size and shrink into place, flooding the field with covers.
 */
export const INTRO_FROM_SCALE = 3.2
export const INTRO_MS = 2600

/** easeOutExpo, from the reference's MIN_LERP_EASING_TYPES — fast, then settles. */
function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - 2 ** (-10 * t)
}

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

  private pinnedState = false

  /**
   * The pinned tile, if any. The now-playing card anchors itself to wherever
   * this lands on screen, so it has to survive panning and lens travel — the
   * boolean alone is not enough to place it.
   */
  pinnedTile: Offset | null = null

  /**
   * True while a song is pinned. The lens travels slower and eases longer, so
   * moving the cursor toward the now-playing card does not drag the atlas.
   */
  get pinned(): boolean {
    return this.pinnedState
  }

  set pinned(on: boolean) {
    if (this.pinnedState === on) return
    this.pinnedState = on
    // Relief eases off while pinned, and the cached field carries relief too.
    this.invalidateField()
  }

  private centre: Point = { x: 0, y: 0 }
  private focalOffset: Offset | null = null
  private focalSong: string | null = null
  private lastFrame = 0
  private readonly focalListeners = new Set<(o: Offset | null) => void>()

  /** Smoothed travel speed, 0 parked to 1 at the ceiling. */
  private speed = 0

  private introFrom = 0
  private introElapsed = 0
  private introMs = 0
  private hoverOffset: Offset | null = null
  private hoverSong: string | null = null
  private readonly hoverListeners = new Set<(o: Offset | null) => void>()
  private readonly frameListeners = new Set<() => void>()

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
      else if (changed === 'lens' || changed === 'fieldLight' || changed === 'preset') {
        this.invalidateField()
      }
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

  /** Fires only once the lens parks. Audio and anything debounced wants this. */
  onFocalChange(cb: (o: Offset | null) => void): () => void {
    this.focalListeners.add(cb)
    return () => this.focalListeners.delete(cb)
  }

  /**
   * Fires as the lens travels, on every tile it crosses. Anything that should
   * track the cursor rather than wait for it — the readouts — wants this.
   */
  onHoverChange(cb: (o: Offset | null) => void): () => void {
    this.hoverListeners.add(cb)
    return () => this.hoverListeners.delete(cb)
  }

  /** 0 parked, 1 at the speed ceiling. Drives the lens softening and the label. */
  get speedScale(): number {
    return this.speed
  }

  private get maxSpeed(): number {
    return this.pinned ? LENS_MAX_SPEED_PINNED : LENS_MAX_SPEED_PX_PER_MS
  }

  /** Relief strength for this frame, eased off while a song is pinned. */
  private get relief(): number {
    return this.settings.relief * (this.pinned ? RELIEF_PINNED_FACTOR : 1)
  }

  private get lens(): Lens {
    return makeLens(
      this.centre.x,
      this.centre.y,
      softenK(this.settings.lensK, this.speed),
      this.settings.current.fieldLight,
    )
  }

  /**
   * Starts the opening reveal. Safe to call at any point; it takes the target
   * size from settings, so changing tile size mid-intro still lands correctly.
   */
  playIntro(durationMs: number = INTRO_MS, fromScale: number = INTRO_FROM_SCALE): void {
    this.introFrom = this.settings.hexSize * fromScale
    this.introElapsed = 0
    this.introMs = durationMs
    this.setHexSize(this.introFrom)
  }

  get introPlaying(): boolean {
    return this.introMs > 0
  }

  private advanceIntro(dtMs: number): void {
    if (this.introMs <= 0) return

    this.introElapsed += dtMs
    const t = Math.min(1, this.introElapsed / this.introMs)
    const target = this.settings.hexSize
    this.setHexSize(this.introFrom + (target - this.introFrom) * easeOutExpo(t))

    if (t >= 1) {
      this.introMs = 0
      // Land exactly on the setting rather than on the tween's last sample.
      this.setHexSize(target)
    }
  }

  /** Advances the eased lens. Called by the frame loop; tests drive it directly. */
  step(dtMs: number): void {
    this.advanceIntro(dtMs)
    const from = this.centre

    if (!this.settled) {
      this.centre = easeCentre(
        this.centre,
        this.lensTarget,
        dtMs,
        this.pinned ? LENS_TAU_PINNED_MS : LENS_TAU_MS,
        this.maxSpeed,
      )
      this.invalidate()
    }

    // Measured from the distance actually covered, not from the target, so a
    // capped step reports the speed it was allowed rather than the one it wanted.
    const travelled = Math.hypot(this.centre.x - from.x, this.centre.y - from.y)
    const instant = dtMs > 0 ? travelled / dtMs / this.maxSpeed : 0
    const next = easeScalar(this.speed, Math.min(1, instant), dtMs)
    if (Math.abs(next - this.speed) > 0.001) {
      this.speed = next
      this.invalidate() // magnification depends on it
    } else if (next !== this.speed && this.settled) {
      this.speed = next
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

    this.updateHover()
  }

  /** The tile under the lens centre right now, published as it changes. */
  private updateHover(): void {
    const next = this.offsetUnderCentre()
    const song = next ? songAt(next, this.layout, this.store) : null
    const songId = song?.id ?? null

    // Track the song as well as the tile, for the same reason updateFocal
    // does: the lens routinely parks on a tile whose cell is still in flight,
    // and comparing tiles alone means the arriving song is never announced.
    const same = next?.col === this.hoverOffset?.col && next?.row === this.hoverOffset?.row
    if (same && songId === this.hoverSong) return

    this.hoverOffset = next
    this.hoverSong = songId
    for (const cb of this.hoverListeners) cb(next)
  }

  private offsetUnderCentre(): Offset | null {
    const world = { x: this.centre.x + this.view.x, y: this.centre.y + this.view.y }
    const o = axialToOffset(pixelToAxial(world, this.layout.hexSize))
    return this.layout.slotAt(o) ? o : null
  }

  /**
   * The focal tile is whatever sits under the lens centre — f(0) = 0, so the
   * centre maps to itself. Only published once the lens has parked, or the
   * audio engine's hover debounce would reset on every eased frame.
   */
  private updateFocal(): void {
    const next = this.offsetUnderCentre()
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

  /**
   * Where a hex is drawn right now, through the same lens the frame used, plus
   * the half-extent its magnified art occupies. Null once it has left the
   * screen, which is the caller's cue that there is nothing to anchor to.
   */
  anchorOf(o: Offset): TileAnchor | null {
    const p = axialToPixel(offsetToAxial(o), this.layout.hexSize)
    const t = transformTile({ x: p.x - this.view.x, y: p.y - this.view.y }, this.lens)
    const clear = this.layout.hexSize * TILE_GAP * Math.max(t.radial, t.tangential)

    const w = window.innerWidth
    const h = window.innerHeight
    if (t.x < -clear || t.x > w + clear || t.y < -clear || t.y > h + clear) return null
    return { x: t.x, y: t.y, clear }
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

  /**
   * Runs after every step, drawn or not. For DOM that has to track the lens
   * continuously rather than react to discrete changes.
   */
  onFrame(cb: () => void): () => void {
    this.frameListeners.add(cb)
    return () => this.frameListeners.delete(cb)
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
      for (const cb of this.frameListeners) cb()
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
          // Deepest under the cursor, flattening to the field's strength at the
          // rim — where the cached layer takes over at exactly the same value.
          relief: reliefAt(this.relief, Math.max(t.radial, t.tangential), lens.k),
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
          // Every tile out here is at scale 1, so they all sit at the ramp's
          // floor. `k` is irrelevant at magnification 1; pass the live one anyway.
          relief: reliefAt(this.relief, 1, this.settings.lensK),
        })
      }
    }

    this.fieldKey = key
    this.fieldStale = false
    return true
  }
}
