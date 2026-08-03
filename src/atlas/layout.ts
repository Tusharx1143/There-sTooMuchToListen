import { axialToPixel, offsetToAxial, HEX_SIZE, type Offset, type Point } from './hex'
import { CELL_COLS, CELL_ROWS, SONGS_PER_CELL, type GenreId } from '../types'

// Re-exported so atlas consumers import geometry from one place.
export { CELL_COLS, CELL_ROWS, SONGS_PER_CELL }

export type CellRef = { country: string; genre: GenreId }
export type Slot = { country: string; genre: GenreId; index: number }

export class AtlasLayout {
  readonly countries: readonly string[]
  readonly genres: readonly GenreId[]
  readonly cols: number
  readonly rows: number

  private readonly countryIndex: Map<string, number>
  private readonly genreIndex: Map<GenreId, number>

  constructor(countries: readonly string[], genres: readonly GenreId[]) {
    this.countries = countries
    this.genres = genres
    this.cols = countries.length * CELL_COLS
    this.rows = genres.length * CELL_ROWS
    this.countryIndex = new Map(countries.map((c, i) => [c, i]))
    this.genreIndex = new Map(genres.map((g, i) => [g, i]))
  }

  /** Total atlas size in world pixels, used by the minimap and pan clamping. */
  get widthPx(): number {
    return Math.sqrt(3) * HEX_SIZE * (this.cols + 0.5)
  }

  get heightPx(): number {
    return 1.5 * HEX_SIZE * (this.rows + 1)
  }

  slotAt(o: Offset): Slot | null {
    if (o.col < 0 || o.col >= this.cols) return null
    if (o.row < 0 || o.row >= this.rows) return null

    const ci = Math.floor(o.col / CELL_COLS)
    const gi = Math.floor(o.row / CELL_ROWS)
    const country = this.countries[ci]
    const genre = this.genres[gi]
    if (country === undefined || genre === undefined) return null

    const localCol = o.col - ci * CELL_COLS
    const localRow = o.row - gi * CELL_ROWS
    return { country, genre, index: localRow * CELL_COLS + localCol }
  }

  cellOrigin(c: CellRef): Offset | null {
    const ci = this.countryIndex.get(c.country)
    const gi = this.genreIndex.get(c.genre)
    if (ci === undefined || gi === undefined) return null
    return { col: ci * CELL_COLS, row: gi * CELL_ROWS }
  }

  /** World-pixel centre of a cell — used by search to jump the viewport. */
  centreOf(c: CellRef): Point | null {
    const origin = this.cellOrigin(c)
    if (!origin) return null
    return axialToPixel(
      offsetToAxial({
        col: origin.col + Math.floor(CELL_COLS / 2),
        row: origin.row + Math.floor(CELL_ROWS / 2),
      }),
    )
  }
}
