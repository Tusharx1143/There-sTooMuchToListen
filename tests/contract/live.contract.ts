import { describe, it, expect } from 'vitest'
import { ItunesSource, topSongsUrl, marketingUrl } from '../../harvest/sources/itunes'

describe('LIVE: iTunes contract', () => {
  it('the genre feed still returns playable songs', async () => {
    const source = new ItunesSource({ limit: 10 })
    const songs = await source.fetchCell('us', 14)

    expect(songs.length).toBeGreaterThan(4)
    const first = songs[0]!
    expect(first.title).toBeTruthy()
    expect(first.artist).toBeTruthy()
    expect(first.preview).toMatch(/^https:\/\//)
    expect(first.art).toMatch(/^https:\/\//)
  }, 30_000)

  it('the marketing fallback feed still parses', async () => {
    const res = await fetch(marketingUrl('br', 10))
    expect(res.ok).toBe(true)
    const body = (await res.json()) as { feed?: { results?: unknown[] } }
    expect(Array.isArray(body.feed?.results)).toBe(true)
  }, 30_000)

  it('preview URLs are actually fetchable', async () => {
    const source = new ItunesSource({ limit: 5 })
    const songs = await source.fetchCell('us', 14)
    const res = await fetch(songs[0]!.preview, { method: 'HEAD' })
    expect(res.ok).toBe(true)
  }, 30_000)

  it('the genre taxonomy still contains our axis genres', async () => {
    const res = await fetch(
      'https://itunes.apple.com/WebObjects/MZStoreServices.woa/ws/genres?id=34',
    )
    const tree = (await res.json()) as Record<string, { subgenres?: Record<string, unknown> }>
    const ids = Object.keys(tree['34']?.subgenres ?? {})
    for (const required of ['14', '18', '21', '1122']) {
      expect(ids, `genre ${required} vanished from Apple's taxonomy`).toContain(required)
    }
  }, 30_000)

  it('builds the expected URL shape', () => {
    expect(topSongsUrl('us', 14, 10)).toContain('/us/rss/topsongs/limit=10/genre=14/json')
  })
})
