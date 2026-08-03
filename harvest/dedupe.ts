import type { Song, SourceName } from './types'

/** Lower number wins when the same song arrives from two sources. */
const SOURCE_RANK: Record<SourceName, number> = { itunes: 0, deezer: 1, jamendo: 2 }

const NOISE = /\s*[([]?\s*(remaster(ed)?|single version|radio edit|deluxe|bonus track|live)\b[^)\]]*[)\]]?\s*$/i
const SUFFIX_DASH = /\s+-\s+.*$/

export function matchKey(song: Song): string {
  const clean = (s: string): string =>
    s
      .toLowerCase()
      .replace(NOISE, '')
      .replace(SUFFIX_DASH, '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '')

  return `${clean(song.artist)}|${clean(song.title)}`
}

export function dedupe(songs: Song[]): Song[] {
  const best = new Map<string, { song: Song; order: number }>()

  songs.forEach((song, order) => {
    const key = matchKey(song)
    const existing = best.get(key)
    if (!existing || SOURCE_RANK[song.source] < SOURCE_RANK[existing.song.source]) {
      best.set(key, { song, order: existing?.order ?? order })
    }
  })

  return [...best.values()].sort((a, b) => a.order - b.order).map((e) => e.song)
}
