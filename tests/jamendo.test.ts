import { describe, it, expect, vi } from 'vitest'
import { JamendoSource, normalizeJamendo, GENRE_TAGS } from '../harvest/sources/jamendo'
import tracks from '../harvest/fixtures/jamendo-tracks.json'

describe('normalizeJamendo', () => {
  it('maps tracks that have audio', () => {
    const songs = normalizeJamendo(tracks, 'us', 21)
    expect(songs).toHaveLength(1)
    expect(songs[0]!.title).toBe('Jamendo Example Track')
    expect(songs[0]!.artist).toBe('Jamendo Example Artist')
  })

  it('marks the source and mp3 type', () => {
    const songs = normalizeJamendo(tracks, 'us', 21)
    expect(songs[0]!.source).toBe('jamendo')
    expect(songs[0]!.previewType).toBe('mp3')
  })

  it('drops tracks with no audio URL', () => {
    expect(normalizeJamendo(tracks, 'us', 21).map((s) => s.title)).not.toContain('No Audio Track')
  })

  it('returns an empty array for junk', () => {
    expect(normalizeJamendo(null, 'us', 21)).toEqual([])
    expect(normalizeJamendo({ results: 'nope' }, 'us', 21)).toEqual([])
  })
})

describe('GENRE_TAGS', () => {
  it('maps our axis genres to Jamendo tags', () => {
    expect(GENRE_TAGS[21]).toBe('rock')
    expect(GENRE_TAGS[11]).toBe('jazz')
  })
})

describe('JamendoSource', () => {
  it('returns an empty array without a client id rather than throwing', async () => {
    const src = new JamendoSource({ clientId: '' })
    expect(await src.fetchCell('us', 21)).toEqual([])
  })

  it('fetches and normalizes when configured', async () => {
    const src = new JamendoSource({ clientId: 'abc', fetcher: async () => tracks })
    expect(await src.fetchCell('us', 21)).toHaveLength(1)
  })

  it('sends the client id in the query', async () => {
    const fetcher = vi.fn(async (_url: string) => tracks)
    const src = new JamendoSource({ clientId: 'abc123', fetcher })
    await src.fetchCell('us', 21)
    expect(fetcher.mock.calls[0]![0]).toContain('client_id=abc123')
  })

  it('skips genres with no Jamendo tag mapping', async () => {
    const fetcher = vi.fn(async () => tracks)
    const src = new JamendoSource({ clientId: 'abc', fetcher })
    expect(await src.fetchCell('us', 99999)).toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('swallows upstream errors', async () => {
    const src = new JamendoSource({
      clientId: 'abc',
      fetcher: async () => { throw new Error('500') },
    })
    expect(await src.fetchCell('us', 21)).toEqual([])
  })
})
