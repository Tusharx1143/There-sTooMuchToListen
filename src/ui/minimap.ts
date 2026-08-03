import type { Point } from '../atlas/hex'
import type { AtlasLayout } from '../atlas/layout'
import type { Rect } from '../atlas/viewport'

const WIDTH = 160
const HEIGHT = 96

export class Minimap {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D

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

  update(view: Rect): void {
    const sx = WIDTH / this.layout.widthPx
    const sy = HEIGHT / this.layout.heightPx

    this.ctx.fillStyle = 'rgba(16,16,24,.9)'
    this.ctx.fillRect(0, 0, WIDTH, HEIGHT)

    // Genre bands, so the map reads as rows of related styles.
    const bandH = HEIGHT / this.layout.genres.length
    for (let i = 0; i < this.layout.genres.length; i++) {
      this.ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.02)'
      this.ctx.fillRect(0, i * bandH, WIDTH, bandH)
    }

    this.ctx.strokeStyle = '#ff7a45'
    this.ctx.lineWidth = 1.5
    this.ctx.strokeRect(
      view.x * sx,
      view.y * sy,
      Math.max(3, view.w * sx),
      Math.max(3, view.h * sy),
    )
  }
}
