import { axialToOffset, pixelToAxial, HEX_SIZE, type Point } from './hex'
import { AtlasLayout, CELL_COLS, CELL_ROWS } from './layout'
import { cellKey } from '../types'

export type Rect = { x: number; y: number; w: number; h: number }
export type OffsetRange = { colMin: number; colMax: number; rowMin: number; rowMax: number }

/**
 * One hex of slack on every side. A hex centre can sit just outside the view
 * while the hex itself is still partly on screen, so we always over-scan by one.
 */
const SLACK = 1

export function visibleOffsets(
  view: Rect,
  layout: AtlasLayout,
  size: number = HEX_SIZE,
): OffsetRange {
  const corners: Point[] = [
    { x: view.x, y: view.y },
    { x: view.x + view.w, y: view.y },
    { x: view.x, y: view.y + view.h },
    { x: view.x + view.w, y: view.y + view.h },
  ]

  let colMin = Infinity
  let colMax = -Infinity
  let rowMin = Infinity
  let rowMax = -Infinity

  for (const c of corners) {
    const { col, row } = axialToOffset(pixelToAxial(c, size))
    colMin = Math.min(colMin, col)
    colMax = Math.max(colMax, col)
    rowMin = Math.min(rowMin, row)
    rowMax = Math.max(rowMax, row)
  }

  return {
    colMin: Math.max(0, colMin - SLACK),
    colMax: Math.min(layout.cols - 1, colMax + SLACK),
    rowMin: Math.max(0, rowMin - SLACK),
    rowMax: Math.min(layout.rows - 1, rowMax + SLACK),
  }
}

export function requiredCellKeys(
  view: Rect,
  layout: AtlasLayout,
  ring: number = 1,
  size: number = HEX_SIZE,
): string[] {
  const range = visibleOffsets(view, layout, size)

  const ciMin = Math.floor(range.colMin / CELL_COLS) - ring
  const ciMax = Math.floor(range.colMax / CELL_COLS) + ring
  const giMin = Math.floor(range.rowMin / CELL_ROWS) - ring
  const giMax = Math.floor(range.rowMax / CELL_ROWS) + ring

  const keys: string[] = []
  for (let gi = giMin; gi <= giMax; gi++) {
    for (let ci = ciMin; ci <= ciMax; ci++) {
      const country = layout.countries[ci]
      const genre = layout.genres[gi]
      if (country === undefined || genre === undefined) continue
      keys.push(cellKey(country, genre))
    }
  }
  return keys
}

/** Keep the view inside the atlas. If the atlas is smaller than the view, pin to 0. */
export function clampView(view: Rect, layout: AtlasLayout): Point {
  const maxX = Math.max(0, layout.widthPx - view.w)
  const maxY = Math.max(0, layout.heightPx - view.h)
  return {
    x: Math.min(Math.max(view.x, 0), maxX),
    y: Math.min(Math.max(view.y, 0), maxY),
  }
}
