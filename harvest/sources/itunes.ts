import { TokenBucket } from '../rateLimit'
import { normalizeItunes } from '../normalize'
import type { GenreId, Song } from '../types'

export type Fetcher = (url: string) => Promise<unknown>

/** A healthy storefront returns a full genre feed. One entry means it is degraded. */
const HEALTH_THRESHOLD = 2
const HEALTH_PROBE_GENRE: GenreId = 14 // Pop — present in every storefront

export function topSongsUrl(country: string, genre: GenreId, limit: number): string {
  return `https://itunes.apple.com/${country}/rss/topsongs/limit=${limit}/genre=${genre}/json`
}

export function marketingUrl(country: string, limit: number): string {
  return `https://rss.applemarketingtools.com/api/v2/${country}/music/most-played/${limit}/songs.json`
}

const defaultFetcher: Fetcher = async (url) => {
  const res = await fetch(url, { headers: { 'user-agent': 'listen-to-anything/1.0' } })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

export class ItunesSource {
  private readonly fetcher: Fetcher
  private readonly bucket: TokenBucket
  private readonly limit: number
  private readonly health = new Map<string, boolean>()

  constructor(opts: { fetcher?: Fetcher; bucket?: TokenBucket; limit?: number } = {}) {
    this.fetcher = opts.fetcher ?? defaultFetcher
    this.bucket = opts.bucket ?? new TokenBucket(8, 8)
    this.limit = opts.limit ?? 50
  }

  private async get(url: string): Promise<unknown> {
    await this.bucket.take()
    return this.fetcher(url)
  }

  /** True when genre-filtered feeds work for this storefront. Probed once per run. */
  async checkStorefront(country: string): Promise<boolean> {
    const cached = this.health.get(country)
    if (cached !== undefined) return cached

    let healthy = false
    try {
      const raw = await this.get(topSongsUrl(country, HEALTH_PROBE_GENRE, this.limit))
      healthy = normalizeItunes(raw, country, HEALTH_PROBE_GENRE).length >= HEALTH_THRESHOLD
    } catch {
      healthy = false
    }

    this.health.set(country, healthy)
    return healthy
  }

  async fetchCell(country: string, genre: GenreId): Promise<Song[]> {
    const healthy = await this.checkStorefront(country)

    if (healthy) {
      try {
        const raw = await this.get(topSongsUrl(country, genre, this.limit))
        return normalizeItunes(raw, country, genre)
      } catch {
        return []
      }
    }

    // Degraded storefront: the marketing feed is not genre-filterable, so every
    // genre in this country draws from the same national chart. Better a real
    // song in roughly the right place than an empty column.
    try {
      const raw = await this.get(marketingUrl(country, this.limit))
      return normalizeMarketing(raw, country, genre)
    } catch {
      return []
    }
  }
}

/** The marketing API has a different shape from the legacy RSS feed. */
function normalizeMarketing(raw: unknown, country: string, genre: GenreId): Song[] {
  const results = (raw as { feed?: { results?: unknown[] } } | null)?.feed?.results
  if (!Array.isArray(results)) {
    // The fallback may itself be served in legacy shape; try that before giving up.
    return normalizeItunes(raw, country, genre)
  }
  return normalizeItunes(
    {
      feed: {
        entry: results.map((r) => {
          const item = r as Record<string, string>
          return {
            'im:name': { label: item['name'] },
            'im:artist': { label: item['artistName'] },
            'im:image': [{ label: item['artworkUrl100'] }],
            id: { attributes: { 'im:id': item['id'] } },
            link: [
              { attributes: { rel: 'alternate', type: 'text/html', href: item['url'] } },
              { attributes: { rel: 'enclosure', type: 'audio/x-m4a', href: item['previewUrl'] } },
            ],
          }
        }),
      },
    },
    country,
    genre,
  )
}
