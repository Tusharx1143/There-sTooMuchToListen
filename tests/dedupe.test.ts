import { describe, it, expect } from 'vitest'
import { dedupe, matchKey } from '../harvest/dedupe'
import type { Song } from '../harvest/types'

function song(over: Partial<Song>): Song {
  return {
    id: 'x', title: 'Title', artist: 'Artist', art: 'a', preview: 'p',
    previewType: 'aac', genre: 14, country: 'us', source: 'itunes',
    link: 'l', yt: 'y', ...over,
  }
}

describe('matchKey', () => {
  it('ignores case, punctuation and spacing', () => {
    expect(matchKey(song({ artist: 'The Band!', title: "Don't  Stop" })))
      .toBe(matchKey(song({ artist: 'the band', title: 'dont stop' })))
  })

  it('ignores common suffixes like (Remastered) and - Single Version', () => {
    expect(matchKey(song({ title: 'Song (Remastered 2011)' })))
      .toBe(matchKey(song({ title: 'Song' })))
    expect(matchKey(song({ title: 'Song - Single Version' })))
      .toBe(matchKey(song({ title: 'Song' })))
  })

  it('keeps genuinely different songs apart', () => {
    expect(matchKey(song({ title: 'A' }))).not.toBe(matchKey(song({ title: 'B' })))
  })
})

describe('dedupe', () => {
  it('removes a duplicate that arrived from a second source', () => {
    const out = dedupe([
      song({ id: '1', source: 'itunes' }),
      song({ id: '2', source: 'deezer' }),
    ])
    expect(out).toHaveLength(1)
  })

  it('prefers iTunes over Deezer over Jamendo', () => {
    expect(dedupe([song({ id: 'd', source: 'deezer' }), song({ id: 'i', source: 'itunes' })])[0]!.id)
      .toBe('i')
    expect(dedupe([song({ id: 'j', source: 'jamendo' }), song({ id: 'd', source: 'deezer' })])[0]!.id)
      .toBe('d')
  })

  it('preserves the order of the songs it keeps', () => {
    const out = dedupe([
      song({ id: '1', title: 'First' }),
      song({ id: '2', title: 'Second' }),
      song({ id: '3', title: 'Third' }),
    ])
    expect(out.map((s) => s.title)).toEqual(['First', 'Second', 'Third'])
  })

  it('handles an empty list', () => {
    expect(dedupe([])).toEqual([])
  })
})
