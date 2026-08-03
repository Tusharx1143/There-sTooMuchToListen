import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  SCHEMA_VERSION, SONGS_PER_CELL,
  type CellStats, type GenreId, type Manifest, type Song,
} from './types'

/** Fewer songs than this and the cell is flagged, but still shipped. */
export const THIN_THRESHOLD = 5

export async function writeCell(dir: string, key: string, songs: Song[]): Promise<CellStats> {
  const capped = songs.slice(0, SONGS_PER_CELL)
  const cellsDir = join(dir, 'cells')
  await mkdir(cellsDir, { recursive: true })
  await writeFile(join(cellsDir, `${key}.json`), JSON.stringify(capped), 'utf8')

  const stats: CellStats = { count: capped.length }
  if (capped.length < THIN_THRESHOLD) stats.thin = true
  return stats
}

/** Used by the resumable runner to skip cells already harvested. */
export async function readExistingCell(dir: string, key: string): Promise<Song[] | null> {
  try {
    const text = await readFile(join(dir, 'cells', `${key}.json`), 'utf8')
    return JSON.parse(text) as Song[]
  } catch {
    return null
  }
}

export function buildManifest(
  cells: Record<string, CellStats>,
  countries: readonly string[],
  genres: readonly { id: GenreId; label: string }[],
): Manifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    harvestedAt: new Date().toISOString(),
    countries: [...countries],
    genres: genres.map((g) => ({ id: g.id, label: g.label })),
    cells,
  }
}

export async function writeManifest(dir: string, manifest: Manifest): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf8')
}
