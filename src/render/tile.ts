/**
 * Below this radial extent a tile is too small to be worth an image request.
 * It has to stay under `HEX_SIZE * TILE_GAP / (LENS_K + 1)` — the tightest a
 * tile gets anywhere inside the lens — or the rim would drop to flat colour
 * while the undistorted field around it carries art, and the seam shows.
 */
export const ART_MIN_PX = 11
/** Below this, skip the hex path entirely and draw a bare rect. */
export const SOLID_MIN_PX = 5
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
  /** How lit this tile is, 0..1. 1 is the focal tile at the lens centre. */
  alpha: number
  /**
   * Set on light themes: recede by washing the tile with this colour rather
   * than by lowering alpha. Fading toward black on a pale ground reads as
   * emphasis, which is the opposite of what a dimmed tile should say.
   */
  wash: string | null
  image: CanvasImageSource | null
  colors: [string, string]
  highlighted: boolean
  /** Failed preview — rendered visibly inert. */
  dim: boolean
  /** Outline colour for the focal tile. */
  highlightColor: string
  /**
   * Relief strength, 0 for a flat tile. The `depth` preset's stand-in: the
   * reference raymarches a height field built from its Voronoi edge buffer and
   * lights it per pixel, which needs a WebGL post pass we do not have. A
   * directional wash plus a lit rim reads as the same embossed surface at a
   * fraction of the cost.
   */
  relief: number
}

/**
 * Fixed key light, upper-left. The reference's light follows the camera, but
 * ours would then depend on the lens position — and the undistorted field is
 * cached precisely because it does not. A static light keeps that cache.
 */
const LIGHT_X = -Math.SQRT1_2
const LIGHT_Y = -Math.SQRT1_2

/**
 * Shades the tile as a lit surface: a gradient across the light axis, then a
 * rim that catches the light on the near edge and falls into shadow opposite.
 * Called inside the caller's hex clip.
 */
function reliefOver(ctx: CanvasRenderingContext2D, strength: number, s: number): void {
  if (strength <= 0) return

  const g = ctx.createLinearGradient(-LIGHT_X * s, -LIGHT_Y * s, LIGHT_X * s, LIGHT_Y * s)
  g.addColorStop(0, `rgba(0,0,0,${(0.5 * strength).toFixed(3)})`)
  g.addColorStop(0.55, 'rgba(0,0,0,0)')
  g.addColorStop(1, `rgba(255,255,255,${(0.3 * strength).toFixed(3)})`)
  ctx.fillStyle = g
  ctx.fillRect(-s, -s, s * 2, s * 2)

  // The rim is what sells it: a height field peaks at the cell edge, so the
  // edge is the brightest part of the surface.
  ctx.lineWidth = Math.max(1, s * 0.09)
  ctx.strokeStyle = `rgba(255,255,255,${(0.22 * strength).toFixed(3)})`
  hexPath(ctx, -s * 0.03, -s * 0.03, s)
  ctx.stroke()
  ctx.strokeStyle = `rgba(0,0,0,${(0.3 * strength).toFixed(3)})`
  hexPath(ctx, s * 0.03, s * 0.03, s)
  ctx.stroke()
}

/** Paints the light-theme recede wash. A no-op on dark themes. */
function washOver(
  ctx: CanvasRenderingContext2D,
  o: TileOpts,
  amount: number,
  s: number,
): void {
  if (amount <= 0 || o.wash === null) return
  ctx.globalAlpha = amount
  ctx.fillStyle = o.wash
  ctx.fillRect(-s, -s, s * 2, s * 2)
  ctx.globalAlpha = 1
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

  // Two ways to recede, one knob. Alpha lets the black ground through; wash
  // paints the pale ground back over the top at the same strength.
  const washAmount = o.wash === null ? 0 : 1 - o.alpha

  ctx.save()
  ctx.globalAlpha = o.wash === null ? o.alpha : 1
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
    washOver(ctx, o, washAmount, s)
    ctx.restore()
    return
  }

  if (tier === 'solid') {
    hexPath(ctx, 0, 0, s)
    ctx.fillStyle = o.colors[0]
    ctx.fill()
    if (washAmount > 0 || o.relief > 0) {
      ctx.save()
      hexPath(ctx, 0, 0, s)
      ctx.clip()
      reliefOver(ctx, o.relief, s)
      washOver(ctx, o, washAmount, s)
      ctx.restore()
    }
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

  reliefOver(ctx, o.relief, s)
  washOver(ctx, o, washAmount, s)

  ctx.restore()

  if (o.highlighted) {
    hexPath(ctx, 0, 0, s)
    ctx.strokeStyle = o.highlightColor
    // Undo the tile's own scaling so the outline keeps a constant screen width.
    ctx.lineWidth = 2 / Math.max(o.radial, o.tangential)
    ctx.stroke()
  }

  ctx.restore()
}
