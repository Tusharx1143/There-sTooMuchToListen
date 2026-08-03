import { createHash } from 'node:crypto'
import { TokenBucket } from '../rateLimit'
import { youtubeSearchUrl } from '../normalize'
import type { Fetcher } from './itunes'
import type { GenreId, Song } from '../types'

/** Jamendo uses free-text tags, so our numeric axis genres need a mapping. */
export const GENRE_TAGS: Record<number, string> = {
  14: 'pop', 20: 'alternative', 21: 'rock', 10: 'songwriter', 1289: 'folk',
  18: 'hiphop', 15: 'soul', 24: 'reggae', 7: 'electronic', 17: 'dance',
  6: 'country', 2: 'blues', 11: 'jazz', 5: 'classical', 16: 'soundtrack',
  53: 'instrumental', 13: 'newage', 25: 'lounge', 23: 'vocal', 22: 'gospel',
  12: 'latin', 1122: 'brazilian', 1203: 'african', 1197: 'arabic',
  1300: 'turkish', 1262: 'indian', 1232: 'chinese', 1243: 'korean',
  27: 'jpop', 19: 'world',
}

type JamendoTrack = {
  id?: string
  name?: string
  artist_name?: string
  album_name?: string
  album_image?: string
  audio?: string
  shareurl?: string
}

export function normalizeJamendo(raw: unknown, country: string, genre: GenreId): Song[] {
  const results = (raw as { results?: unknown } | null)?.results
  if (!Array.isArray(results)) return []

  const songs: Song[] = []
  for (const item of results as JamendoTrack[]) {
    if (!item.audio || !item.id) continue

    const artist = item.artist_name ?? ''
    const title = item.name ?? ''

    songs.push({
      id: createHash('sha1').update(`jamendo:${item.id}`).digest('hex').slice(0, 16),
      title,
      artist,
      ...(item.album_name ? { album: item.album_name } : {}),
      art: item.album_image ?? '',
      preview: item.audio,
      previewType: 'mp3',
      genre,
      country,
      source: 'jamendo',
      link: item.shareurl ?? '',
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

export class JamendoSource {
  private readonly clientId: string
  private readonly fetcher: Fetcher
  private readonly bucket: TokenBucket
  private readonly limit: number

  constructor(
    opts: { clientId?: string; fetcher?: Fetcher; bucket?: TokenBucket; limit?: number } = {},
  ) {
    this.clientId = opts.clientId ?? process.env['JAMENDO_CLIENT_ID'] ?? ''
    this.fetcher = opts.fetcher ?? defaultFetcher
    this.bucket = opts.bucket ?? new TokenBucket(4, 4)
    this.limit = opts.limit ?? 50
  }

  async fetchCell(country: string, genre: GenreId): Promise<Song[]> {
    if (!this.clientId) return []

    const tag = GENRE_TAGS[genre]
    if (!tag) return []

    await this.bucket.take()
    const url =
      `https://api.jamendo.com/v3.0/tracks/?client_id=${this.clientId}` +
      `&format=json&limit=${this.limit}&tags=${tag}&order=popularity_total&audioformat=mp31`

    try {
      return normalizeJamendo(await this.fetcher(url), country, genre)
    } catch {
      return []
    }
  }
}
