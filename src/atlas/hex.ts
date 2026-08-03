export type Axial = { q: number; r: number }
export type Offset = { col: number; row: number }
export type Point = { x: number; y: number }

/** Distance from a hex centre to a corner, in CSS pixels. */
export const HEX_SIZE = 34

const SQRT3 = Math.sqrt(3)

/**
 * odd-r offset → axial. Works for negative rows: in JS, (-3 & 1) === 1,
 * which is exactly the parity we want.
 */
export function offsetToAxial(o: Offset): Axial {
  return { q: o.col - (o.row - (o.row & 1)) / 2, r: o.row }
}

export function axialToOffset(a: Axial): Offset {
  return { col: a.q + (a.r - (a.r & 1)) / 2, row: a.r }
}

export function axialToPixel(a: Axial, size: number = HEX_SIZE): Point {
  return {
    x: size * SQRT3 * (a.q + a.r / 2),
    y: size * 1.5 * a.r,
  }
}

export function pixelToAxial(p: Point, size: number = HEX_SIZE): Axial {
  const qf = ((SQRT3 / 3) * p.x - p.y / 3) / size
  const rf = ((2 / 3) * p.y) / size
  return axialRound(qf, rf)
}

/** Cube rounding: round all three axes, then correct the one that moved most. */
export function axialRound(qf: number, rf: number): Axial {
  const xf = qf
  const zf = rf
  const yf = -xf - zf

  let x = Math.round(xf)
  let y = Math.round(yf)
  let z = Math.round(zf)

  const dx = Math.abs(x - xf)
  const dy = Math.abs(y - yf)
  const dz = Math.abs(z - zf)

  if (dx > dy && dx > dz) x = -y - z
  else if (dy > dz) y = -x - z
  else z = -x - y

  return { q: x, r: z }
}
