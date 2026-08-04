import type { Point } from '../atlas/hex'
import type { AtlasLayout } from '../atlas/layout'
import type { Rect } from '../atlas/viewport'
import { PALETTES, type Palette } from '../state/theme'

const WIDTH = 160
const HEIGHT = 96

export class Minimap {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private colors: Palette['minimap'] = PALETTES.dark.minimap
  private last: Rect | null = null

  constructor(
    root: HTMLElement,
    private readonly layout: AtlasLayout,
    onJump: (world: Point) => void,
  ) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = WIDTH
    this.canvas.height = HEIGHT
    this.canvas.className = 'minimap'
    this.canvas.setAttribute('data-minimap', '')

    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('2d context unavailable for minimap')
    this.ctx = ctx

    this.canvas.addEventListener('click', (e) => {
      const r = this.canvas.getBoundingClientRect()
      onJump({
        x: ((e.clientX - r.left) / r.width) * layout.widthPx,
        y: ((e.clientY - r.top) / r.height) * layout.heightPx,
      })
    })

    root.appendChild(this.canvas)
  }

  /** Repaints in the new theme's colours, keeping the current viewport rect. */
  setPalette(p: Palette): void {
    this.colors = p.minimap
    if (this.last) this.update(this.last)
  }

  update(view: Rect): void {
    this.last = view
    const sx = WIDTH / this.layout.widthPx
    const sy = HEIGHT / this.layout.heightPx

    this.ctx.fillStyle = this.colors.bg
    this.ctx.fillRect(0, 0, WIDTH, HEIGHT)

    // Genre bands, so the map reads as rows of related styles.
    const bandH = HEIGHT / this.layout.genres.length
    for (let i = 0; i < this.layout.genres.length; i++) {
      if (i % 2 !== 0) continue
      this.ctx.fillStyle = this.colors.band
      this.ctx.fillRect(0, i * bandH, WIDTH, bandH)
    }

    this.ctx.strokeStyle = this.colors.view
    this.ctx.lineWidth = 1.5
    this.ctx.strokeRect(
      view.x * sx,
      view.y * sy,
      Math.max(3, view.w * sx),
      Math.max(3, view.h * sy),
    )
  }
}
