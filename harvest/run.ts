import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { COUNTRIES, GENRES } from './taxonomy'
import { ItunesSource } from './sources/itunes'
import { DeezerSource } from './sources/deezer'
import { dedupe } from './dedupe'
import { buildManifest, readExistingCell, writeCell, writeManifest } from './emit'
import { cellKey, type CellStats, type GenreId, type Manifest, type Song } from './types'

export type SourceLike = { fetchCell(country: string, genre: GenreId): Promise<Song[]> }

export type HarvestOptions = {
  dir: string
  countries?: readonly string[]
  genres?: readonly { id: GenreId; label: string }[]
  source?: SourceLike
  secondary?: SourceLike
  force?: boolean
  onProgress?: (done: number, total: number, key: string) => void
}

export async function harvestAll(opts: HarvestOptions): Promise<Manifest> {
  const countries = opts.countries ?? COUNTRIES
  const genres = opts.genres ?? GENRES
  const source = opts.source ?? new ItunesSource()
  const cells: Record<string, CellStats> = {}

  const total = countries.length * genres.length
  let done = 0

  for (const country of countries) {
    for (const genre of genres) {
      const key = cellKey(country, genre.id)

      if (!opts.force) {
        const existing = await readExistingCell(opts.dir, key)
        if (existing !== null) {
          if (existing.length > 0) cells[key] = await writeCell(opts.dir, key, existing)
          opts.onProgress?.(++done, total, key)
          continue
        }
      }

      let songs: Song[] = []
      try {
        songs = dedupe(await source.fetchCell(country, genre.id))

        // Top up thin cells from the secondary source.
        if (opts.secondary && songs.length < 20) {
          const extra = await opts.secondary.fetchCell(country, genre.id).catch(() => [])
          songs = dedupe([...songs, ...extra])
        }
      } catch (err) {
        console.warn(`[harvest] ${key} failed: ${(err as Error).message}`)
        songs = []
      }

      // An empty cell is omitted from the manifest entirely; the atlas
      // closes the gap rather than rendering a hole.
      if (songs.length > 0) cells[key] = await writeCell(opts.dir, key, songs)

      opts.onProgress?.(++done, total, key)
    }
  }

  const manifest = buildManifest(cells, countries, genres)
  await writeManifest(opts.dir, manifest)
  return manifest
}

// CLI entrypoint: npm run harvest -- [--force]
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = join(process.cwd(), 'public', 'data')
  const force = process.argv.includes('--force')

  harvestAll({
    dir,
    force,
    secondary: new DeezerSource(),
    onProgress: (d, t, key) => {
      if (d % 25 === 0 || d === t) console.log(`[harvest] ${d}/${t} (${key})`)
    },
  })
    .then((m) => {
      const thin = Object.values(m.cells).filter((c) => c.thin).length
      console.log(`[harvest] done: ${Object.keys(m.cells).length} cells, ${thin} thin`)
    })
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
