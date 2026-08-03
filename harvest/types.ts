export type GenreId = number

export type SourceName = 'itunes' | 'deezer' | 'jamendo'

export type Song = {
  id: string
  title: string
  artist: string
  album?: string
  art: string
  preview: string
  previewType: 'aac' | 'mp3'
  genre: GenreId
  country: string
  source: SourceName
  link: string
  yt: string
}

export type CellStats = { count: number; thin?: boolean }

export type Manifest = {
  schemaVersion: number
  harvestedAt: string
  countries: string[]
  genres: { id: GenreId; label: string }[]
  cells: Record<string, CellStats>
}

export const SCHEMA_VERSION = 1

/**
 * Atlas geometry. Lives here rather than in src/atlas/layout.ts because the
 * harvest needs it too, and harvest/ must never import from src/.
 */
export const CELL_COLS = 5
export const CELL_ROWS = 10
export const SONGS_PER_CELL = CELL_COLS * CELL_ROWS

export function cellKey(country: string, genre: GenreId): string {
  return `${country}-${genre}`
}
