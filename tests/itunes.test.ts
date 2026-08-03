import { describe, it, expect, vi } from 'vitest'
import { ItunesSource, topSongsUrl, marketingUrl } from '../harvest/sources/itunes'
import multi from '../harvest/fixtures/itunes-br-1122.json'
import single from '../harvest/fixtures/itunes-single-entry.json'

describe('URL builders', () => {
  it('builds the genre feed URL', () => {
    expect(topSongsUrl('br', 1122, 50)).toBe(
      'https://itunes.apple.com/br/rss/topsongs/limit=50/genre=1122/json',
    )
  })
  it('builds the marketing fallback URL', () => {
    expect(marketingUrl('kr', 50)).toBe(
      'https://rss.applemarketingtools.com/api/v2/kr/music/most-played/50/songs.json',
    )
  })
})

describe('checkStorefront', () => {
  it('accepts a storefront whose genre feed returns many entries', async () => {
    const src = new ItunesSource({ fetcher: async () => multi })
    expect(await src.checkStorefront('br')).toBe(true)
  })

  it('rejects a storefront whose genre feed returns a single entry', async () => {
    const src = new ItunesSource({ fetcher: async () => single })
    expect(await src.checkStorefront('kr')).toBe(false)
  })

  it('rejects a storefront that throws', async () => {
    const src = new ItunesSource({
      fetcher: async () => { throw new Error('502') },
    })
    expect(await src.checkStorefront('xx')).toBe(false)
  })

  it('caches the verdict so it is probed once per run', async () => {
    const fetcher = vi.fn(async () => multi)
    const src = new ItunesSource({ fetcher })
    await src.checkStorefront('br')
    await src.checkStorefront('br')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe('fetchCell', () => {
  it('returns normalized songs from the genre feed', async () => {
    const src = new ItunesSource({ fetcher: async () => multi })
    const songs = await src.fetchCell('br', 1122)
    expect(songs).toHaveLength(2)
    expect(songs[0]!.country).toBe('br')
    expect(songs[0]!.genre).toBe(1122)
  })

  it('falls back to the marketing feed for an unhealthy storefront', async () => {
    const seen: string[] = []
    const fetcher = vi.fn(async (url: string) => {
      seen.push(url)
      return url.includes('applemarketingtools') ? multi : single
    })
    const src = new ItunesSource({ fetcher })
    const songs = await src.fetchCell('kr', 14)

    expect(seen.some((u) => u.includes('applemarketingtools'))).toBe(true)
    expect(songs.length).toBeGreaterThan(0)
    // Fallback songs are still stamped with the cell we asked for.
    expect(songs[0]!.country).toBe('kr')
    expect(songs[0]!.genre).toBe(14)
  })

  it('returns an empty array instead of throwing when the feed fails', async () => {
    const src = new ItunesSource({
      fetcher: async (url) => {
        if (url.includes('genre=')) throw new Error('timeout')
        return { feed: {} }
      },
    })
    expect(await src.fetchCell('us', 14)).toEqual([])
  })
})
