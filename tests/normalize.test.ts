import { describe, it, expect } from 'vitest'
import { normalizeItunes, upgradeArtwork, youtubeSearchUrl } from '../harvest/normalize'
import multi from '../harvest/fixtures/itunes-br-1122.json'
import single from '../harvest/fixtures/itunes-single-entry.json'

describe('normalizeItunes', () => {
  it('maps a two-entry feed to two songs', () => {
    const songs = normalizeItunes(multi, 'br', 1122)
    expect(songs).toHaveLength(2)
    expect(songs[0]!.title).toBe('Example Track One')
    expect(songs[0]!.artist).toBe('Example Artist')
    expect(songs[0]!.album).toBe('Example Album')
  })

  it('stamps the requested country and genre, not the feed category', () => {
    // The first fixture entry self-reports category 1225 (MPB), but we asked for 1122.
    const songs = normalizeItunes(multi, 'br', 1122)
    expect(songs[0]!.genre).toBe(1122)
    expect(songs[0]!.country).toBe('br')
  })

  it('handles a single-entry feed returned as an object, not an array', () => {
    const songs = normalizeItunes(single, 'kr', 14)
    expect(songs).toHaveLength(1)
    expect(songs[0]!.title).toBe('Lonely Entry')
  })

  it('takes the preview URL from the enclosure link', () => {
    const songs = normalizeItunes(multi, 'br', 1122)
    expect(songs[0]!.preview).toBe('https://audio-ssl.itunes.apple.com/x/one.m4a')
    expect(songs[0]!.previewType).toBe('aac')
  })

  it('takes the store page from the alternate link', () => {
    const songs = normalizeItunes(multi, 'br', 1122)
    expect(songs[0]!.link).toBe('https://music.apple.com/br/album/x/1')
  })

  it('upgrades artwork to 600px', () => {
    const songs = normalizeItunes(multi, 'br', 1122)
    expect(songs[0]!.art).toContain('600x600')
  })

  it('builds a stable id from source and store id', () => {
    const a = normalizeItunes(multi, 'br', 1122)
    const b = normalizeItunes(multi, 'br', 1122)
    expect(a[0]!.id).toBe(b[0]!.id)
    expect(a[0]!.id).not.toBe(a[1]!.id)
  })

  it('builds a YouTube search link', () => {
    const songs = normalizeItunes(multi, 'br', 1122)
    expect(songs[0]!.yt).toBe(
      'https://www.youtube.com/results?search_query=Example%20Artist%20Example%20Track%20One',
    )
  })

  it('drops entries with no preview URL rather than emitting a silent tile', () => {
    const broken = {
      feed: {
        entry: [
          {
            'im:name': { label: 'No Preview' },
            'im:artist': { label: 'Nobody' },
            'im:image': [{ label: 'https://x/170x170bb.png' }],
            link: [{ attributes: { rel: 'alternate', type: 'text/html', href: 'https://x' } }],
            id: { attributes: { 'im:id': '9' } },
          },
        ],
      },
    }
    expect(normalizeItunes(broken, 'us', 14)).toHaveLength(0)
  })

  it('returns an empty array for a feed with no entries at all', () => {
    expect(normalizeItunes({ feed: {} }, 'us', 14)).toEqual([])
    expect(normalizeItunes(null, 'us', 14)).toEqual([])
  })
})

describe('upgradeArtwork', () => {
  it('rewrites the size segment', () => {
    expect(upgradeArtwork('https://x/thumb/aaa/170x170bb.png')).toBe(
      'https://x/thumb/aaa/600x600bb.jpg',
    )
  })

  it('leaves an unrecognised URL untouched', () => {
    expect(upgradeArtwork('https://x/cover.png')).toBe('https://x/cover.png')
  })
})

describe('youtubeSearchUrl', () => {
  it('encodes artist and title', () => {
    expect(youtubeSearchUrl('A & B', 'C/D')).toBe(
      'https://www.youtube.com/results?search_query=A%20%26%20B%20C%2FD',
    )
  })
})
