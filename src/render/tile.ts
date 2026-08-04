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
   * lights it per pixel, which needs a WebGL post pass we do not have. A body
   * gradient, a bevelled edge and a sunken face read as the same plate-in-a-
   * frame at a fraction of the cost. Pass it through `reliefAt` so it ramps
   * with the lens.
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

/** Bevel band width as a fraction of the hex radius. */
const BEVEL = 0.34

/**
 * How much of the relief the flat field carries, against the focal tile's 1.
 *
 * The reference scales its whole raymarch by `rmMod = 1 - cfDist`, so the
 * height field is deepest under the cursor and flattens toward the edges of
 * the screen. This is the same ramp, expressed as a multiplier on the shading
 * rather than on a march step.
 */
export const RELIEF_FIELD_SCALE = 0.72

/**
 * Relief strength for a tile at this magnification: `RELIEF_FIELD_SCALE` of
 * `base` out in the undistorted field, rising to all of it on the focal tile,
 * so the pick under the cursor visibly stands proud of the plate around it.
 *
 * Magnification is exactly 1 at the lens rim, which is where the cached field
 * takes over — so the two layers meet at the same strength and there is no
 * seam at the boundary.
 */
export function reliefAt(base: number, magnification: number, k: number): number {
  if (base <= 0) return 0
  const t = k <= 0 ? 0 : Math.min(1, Math.max(0, (magnification - 1) / k))
  return base * (RELIEF_FIELD_SCALE + (1 - RELIEF_FIELD_SCALE) * t)
}

/** rgba() with the alpha clamped into range, so a boosted strength stays legal. */
function shade(rgb: string, alpha: number): string {
  return `rgba(${rgb},${Math.min(1, Math.max(0, alpha)).toFixed(3)})`
}

/**
 * Shades the tile as a lit plate sunk into a raised frame — our stand-in for
 * the reference's raymarched height field, which peaks along the Voronoi edge
 * and drops into a depression over the media. Three passes, all inside the
 * caller's hex clip:
 *
 *   1. a body gradient across the light axis, for the plate's own curvature;
 *   2. a bevel: one thick stroke along the hex edge whose gradient runs lit to
 *      shadowed. The clip cuts away its outer half, so what survives is the
 *      inward-facing bevel face — the ridge seen from inside the cell;
 *   3. a well: the face darkens toward the rim, because the art sits below the
 *      ridge rather than flush with it.
 */
function reliefOver(ctx: CanvasRenderingContext2D, strength: number, s: number): void {
  if (strength <= 0) return

  const body = ctx.createLinearGradient(-LIGHT_X * s, -LIGHT_Y * s, LIGHT_X * s, LIGHT_Y * s)
  body.addColorStop(0, shade('0,0,0', 0.62 * strength))
  body.addColorStop(0.5, 'rgba(0,0,0,0)')
  body.addColorStop(1, shade('255,255,255', 0.34 * strength))
  ctx.fillStyle = body
  ctx.fillRect(-s, -s, s * 2, s * 2)

  const bevel = ctx.createLinearGradient(LIGHT_X * s, LIGHT_Y * s, -LIGHT_X * s, -LIGHT_Y * s)
  bevel.addColorStop(0, shade('255,255,255', 0.8 * strength))
  bevel.addColorStop(0.45, shade('255,255,255', 0.06 * strength))
  bevel.addColorStop(0.55, shade('0,0,0', 0.14 * strength))
  bevel.addColorStop(1, shade('0,0,0', 0.85 * strength))
  ctx.lineWidth = Math.max(1, s * BEVEL)
  ctx.strokeStyle = bevel
  hexPath(ctx, 0, 0, s)
  ctx.stroke()

  const well = ctx.createRadialGradient(0, 0, s * 0.3, 0, 0, s)
  well.addColorStop(0, 'rgba(0,0,0,0)')
  well.addColorStop(1, shade('0,0,0', 0.4 * strength))
  ctx.fillStyle = well
  ctx.fillRect(-s, -s, s * 2, s * 2)
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
