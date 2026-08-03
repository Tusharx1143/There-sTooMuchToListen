import { describe, it, expect, vi } from 'vitest'
import { DeezerSource, normalizeDeezer } from '../harvest/sources/deezer'
import chart from '../harvest/fixtures/deezer-chart.json'

describe('normalizeDeezer', () => {
  it('maps tracks with a preview', () => {
    const songs = normalizeDeezer(chart, 'fr', 14)
    expect(songs).toHaveLength(1)
    expect(songs[0]!.title).toBe('Deezer Example Track')
    expect(songs[0]!.artist).toBe('Deezer Example Artist')
    expect(songs[0]!.album).toBe('Deezer Example Album')
  })

  it('marks the source and mp3 preview type', () => {
    const songs = normalizeDeezer(chart, 'fr', 14)
    expect(songs[0]!.source).toBe('deezer')
    expect(songs[0]!.previewType).toBe('mp3')
  })

  it('drops tracks with an empty preview', () => {
    expect(normalizeDeezer(chart, 'fr', 14).map((s) => s.title)).not.toContain('Second Deezer Track')
  })

  it('stamps the requested country and genre', () => {
    const songs = normalizeDeezer(chart, 'fr', 14)
    expect(songs[0]!.country).toBe('fr')
    expect(songs[0]!.genre).toBe(14)
  })

  it('builds a YouTube link', () => {
    expect(normalizeDeezer(chart, 'fr', 14)[0]!.yt).toContain('youtube.com/results')
  })

  it('returns an empty array for junk input', () => {
    expect(normalizeDeezer(null, 'fr', 14)).toEqual([])
    expect(normalizeDeezer({ data: 'nope' }, 'fr', 14)).toEqual([])
  })
})

describe('DeezerSource', () => {
  it('fetches and normalizes a cell', async () => {
    const src = new DeezerSource({ fetcher: async () => chart })
    expect(await src.fetchCell('fr', 14)).toHaveLength(1)
  })

  it('returns an empty array instead of throwing', async () => {
    const src = new DeezerSource({ fetcher: async () => { throw new Error('429') } })
    expect(await src.fetchCell('fr', 14)).toEqual([])
  })

  it('does not create ids that collide with iTunes ids', async () => {
    const src = new DeezerSource({ fetcher: async () => chart })
    const songs = await src.fetchCell('fr', 14)
    expect(songs[0]!.id).toBeTruthy()
    expect(songs[0]!.id).not.toBe('')
  })
})
