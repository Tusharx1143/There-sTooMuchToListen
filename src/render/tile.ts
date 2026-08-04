/**
 * Below this radial extent a tile is too small to be worth an image request.
 * It has to stay under `HEX_SIZE * TILE_GAP / (LENS_K + 1)` — the tightest a
 * tile gets anywhere inside the lens — or the rim would drop to flat colour
 * while the undistorted field around it carries art, and the seam shows.
 */
export const ART_MIN_PX = 14
/** Below this, skip the hex path entirely and draw a bare rect. */
export const SOLID_MIN_PX = 6
export const TILE_GAP = 0.94

export type TileTier = 'art' | 'solid' | 'speck'

/**
 * Keyed on the tile's radial (smaller) extent, not the tangential one: under
 * the lens a rim tile can be 40px across and 5px deep, and a sliver is not a
 * readable cover.
 */
export function tileTier(radialPx: number): TileTier {
  if (radialPx >= ART_MIN_PX) return 'art'
  if (radialPx >= SOLID_MIN_PX) return 'solid'
  return 'speck'
}

export type TileOpts = {
  x: number
  y: number
  /** Pre-transform hex radius: HEX_SIZE * TILE_GAP. */
  size: number
  angle: number
  radial: number
  tangential: number
  alpha: number
  image: CanvasImageSource | null
  colors: [string, string]
  highlighted: boolean
  /** Failed preview — rendered visibly inert. */
  dim: boolean
}

/** Pointy-top hexagon path centred on (cx, cy). */
export function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 90)
    const x = cx + size * Math.cos(angle)
    const y = cy + size * Math.sin(angle)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

export function drawTile(ctx: CanvasRenderingContext2D, o: TileOpts): void {
  const tier = tileTier(o.size * o.radial)
  const s = o.size

  ctx.save()
  ctx.globalAlpha = o.alpha
  ctx.translate(o.x, o.y)

  // Everything outside the lens comes through at scale 1; skipping the
  // transform there is what keeps most of the field cheap.
  if (o.radial !== 1 || o.tangential !== 1) {
    ctx.rotate(o.angle)
    ctx.scale(o.radial, o.tangential)
  }

  if (tier === 'speck') {
    ctx.fillStyle = o.colors[0]
    ctx.fillRect(-s, -s, s * 2, s * 2)
    ctx.restore()
    return
  }

  if (tier === 'solid') {
    hexPath(ctx, 0, 0, s)
    ctx.fillStyle = o.colors[0]
    ctx.fill()
    ctx.restore()
    return
  }

  ctx.save()
  hexPath(ctx, 0, 0, s)
  ctx.clip()

  if (o.image) {
    // Album art is square; cover the hex's bounding box.
    const d = s * 2
    ctx.drawImage(o.image, -d / 2, -d / 2, d, d)
  } else {
    const g = ctx.createLinearGradient(-s, -s, s, s)
    g.addColorStop(0, o.colors[0])
    g.addColorStop(1, o.colors[1])
    ctx.fillStyle = g
    ctx.fillRect(-s, -s, s * 2, s * 2)
  }

  if (o.dim) {
    ctx.fillStyle = 'rgba(7, 7, 12, 0.45)'
    ctx.fillRect(-s, -s, s * 2, s * 2)
  }

  ctx.restore()

  if (o.highlighted) {
    hexPath(ctx, 0, 0, s)
    ctx.strokeStyle = '#ffffff'
    // Undo the tile's own scaling so the outline keeps a constant screen width.
    ctx.lineWidth = 2 / Math.max(o.radial, o.tangential)
    ctx.stroke()
  }

  ctx.restore()
}
