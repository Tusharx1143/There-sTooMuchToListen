/** Below this radial extent a tile is too small to be worth an image request. */
export const ART_MIN_PX = 32
/** Below this, skip the hex path entirely and draw a bare rect. */
export const SOLID_MIN_PX = 8
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
  cx: number
  cy: number
  size: number
  image: CanvasImageSource | null
  colors: [string, string]
  scale: number
  highlighted: boolean
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
  const size = o.size * o.scale

  ctx.save()
  hexPath(ctx, o.cx, o.cy, size)
  ctx.clip()

  if (o.image) {
    // Album art is square; cover the hex's bounding box.
    const d = size * 2
    ctx.drawImage(o.image, o.cx - d / 2, o.cy - d / 2, d, d)
  } else {
    const g = ctx.createLinearGradient(o.cx - size, o.cy - size, o.cx + size, o.cy + size)
    g.addColorStop(0, o.colors[0])
    g.addColorStop(1, o.colors[1])
    ctx.fillStyle = g
    ctx.fillRect(o.cx - size, o.cy - size, size * 2, size * 2)
  }

  if (o.dim) {
    ctx.fillStyle = 'rgba(7, 7, 12, 0.45)'
    ctx.fillRect(o.cx - size, o.cy - size, size * 2, size * 2)
  }

  ctx.restore()

  if (o.highlighted) {
    hexPath(ctx, o.cx, o.cy, size)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.stroke()
  }
}
