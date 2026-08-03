import { createHash } from 'node:crypto'
import type { GenreId, Song } from './types'

type Labelled = { label?: string } | undefined
type LinkAttrs = { rel?: string; type?: string; href?: string }

/** Apple returns `entry` as an object when the feed has exactly one item. */
function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function label(node: Labelled): string {
  return node?.label ?? ''
}

export function upgradeArtwork(url: string): string {
  return url.replace(/\/\d+x\d+bb\.(png|jpg)$/, '/600x600bb.jpg')
}

export function youtubeSearchUrl(artist: string, title: string): string {
  const q = encodeURIComponent(`${artist} ${title}`).replace(/%2520/g, '%20')
  return `https://www.youtube.com/results?search_query=${q}`
}

function stableId(source: string, storeId: string): string {
  return createHash('sha1').update(`${source}:${storeId}`).digest('hex').slice(0, 16)
}

export function normalizeItunes(raw: unknown, country: string, genre: GenreId): Song[] {
  const feed = (raw as { feed?: { entry?: unknown } } | null)?.feed
  const entries = asArray(feed?.entry as Record<string, unknown> | Record<string, unknown>[])

  const songs: Song[] = []

  for (const entry of entries) {
    const links = asArray(entry['link'] as { attributes?: LinkAttrs }[])
    const enclosure = links.find((l) => l.attributes?.rel === 'enclosure')
    const alternate = links.find((l) => l.attributes?.rel === 'alternate')

    const preview = enclosure?.attributes?.href
    if (!preview) continue // a tile with no audio is worse than no tile

    const images = asArray(entry['im:image'] as Labelled[])
    const largest = images[images.length - 1]
    const storeId = (entry['id'] as { attributes?: { 'im:id'?: string } } | undefined)
      ?.attributes?.['im:id']
    if (!storeId) continue

    const title = label(entry['im:name'] as Labelled)
    const artist = label(entry['im:artist'] as Labelled)
    const album = label(
      (entry['im:collection'] as { 'im:name'?: Labelled } | undefined)?.['im:name'],
    )

    songs.push({
      id: stableId('itunes', storeId),
      title,
      artist,
      ...(album ? { album } : {}),
      art: upgradeArtwork(label(largest)),
      preview,
      previewType: 'aac',
      // Always the genre we requested — never the entry's self-reported,
      // localized category.
      genre,
      country,
      source: 'itunes',
      link: alternate?.attributes?.href ?? '',
      yt: youtubeSearchUrl(artist, title),
    })
  }

  return songs
}
