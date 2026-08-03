import { createHash } from 'node:crypto'
import { TokenBucket } from '../rateLimit'
import { youtubeSearchUrl } from '../normalize'
import type { Fetcher } from './itunes'
import type { GenreId, Song } from '../types'

type DeezerTrack = {
  id?: number
  title?: string
  preview?: string
  link?: string
  artist?: { name?: string }
  album?: { title?: string; cover_big?: string }
}

export function normalizeDeezer(raw: unknown, country: string, genre: GenreId): Song[] {
  const data = (raw as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []

  const songs: Song[] = []
  for (const item of data as DeezerTrack[]) {
    if (!item.preview || !item.id) continue

    const artist = item.artist?.name ?? ''
    const title = item.title ?? ''
    const album = item.album?.title

    songs.push({
      id: createHash('sha1').update(`deezer:${item.id}`).digest('hex').slice(0, 16),
      title,
      artist,
      ...(album ? { album } : {}),
      art: item.album?.cover_big ?? '',
      preview: item.preview,
      previewType: 'mp3',
      genre,
      country,
      source: 'deezer',
      link: item.link ?? '',
      yt: youtubeSearchUrl(artist, title),
    })
  }
  return songs
}

const defaultFetcher: Fetcher = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

export class DeezerSource {
  private readonly fetcher: Fetcher
  private readonly bucket: TokenBucket
  private readonly limit: number

  constructor(opts: { fetcher?: Fetcher; bucket?: TokenBucket; limit?: number } = {}) {
    this.fetcher = opts.fetcher ?? defaultFetcher
    // Deezer allows ~50 requests per 5 seconds.
    this.bucket = opts.bucket ?? new TokenBucket(8, 8)
    this.limit = opts.limit ?? 50
  }

  async fetchCell(country: string, genre: GenreId): Promise<Song[]> {
    await this.bucket.take()
    const url =
      `https://api.deezer.com/search?q=${encodeURIComponent(`country:"${country}"`)}` +
      `&limit=${this.limit}`
    try {
      return normalizeDeezer(await this.fetcher(url), country, genre)
    } catch {
      return []
    }
  }
}
