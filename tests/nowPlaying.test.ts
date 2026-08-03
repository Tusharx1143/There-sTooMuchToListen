import { describe, it, expect, vi } from 'vitest'
import { NowPlayingCard } from '../src/ui/nowPlaying'
import type { Song } from '../src/types'

const song: Song = {
  id: 'a', title: 'Track Title', artist: 'Artist Name', album: 'Album Name',
  art: 'https://cdn/art.jpg', preview: 'https://cdn/p.m4a', previewType: 'aac',
  genre: 14, country: 'us', source: 'itunes',
  link: 'https://music.apple.com/x', yt: 'https://www.youtube.com/results?search_query=x',
}

describe('NowPlayingCard', () => {
  it('is hidden until shown', () => {
    const root = document.createElement('div')
    new NowPlayingCard(root, () => {})
    expect(root.querySelector('[data-now-playing].visible')).toBeNull()
  })

  it('shows title, artist and album', () => {
    const root = document.createElement('div')
    const card = new NowPlayingCard(root, () => {})
    card.show(song)
    const text = root.textContent ?? ''
    expect(text).toContain('Track Title')
    expect(text).toContain('Artist Name')
    expect(text).toContain('Album Name')
  })

  it('links out to YouTube and the store page', () => {
    const root = document.createElement('div')
    new NowPlayingCard(root, () => {}).show(song)
    const hrefs = [...root.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(hrefs).toContain(song.yt)
    expect(hrefs).toContain(song.link)
  })

  it('opens outbound links in a new tab safely', () => {
    const root = document.createElement('div')
    new NowPlayingCard(root, () => {}).show(song)
    for (const a of root.querySelectorAll('a')) {
      expect(a.getAttribute('target')).toBe('_blank')
      expect(a.getAttribute('rel')).toContain('noopener')
    }
  })

  it('calls onClose when the close button is clicked', () => {
    const root = document.createElement('div')
    const onClose = vi.fn()
    const card = new NowPlayingCard(root, onClose)
    card.show(song)
    root.querySelector<HTMLElement>('[data-close]')!.click()
    expect(onClose).toHaveBeenCalled()
  })

  it('escapes markup in song text rather than injecting it', () => {
    const root = document.createElement('div')
    const card = new NowPlayingCard(root, () => {})
    card.show({ ...song, title: '<img src=x onerror=alert(1)>' })
    expect(root.querySelector('img')).toBeNull()
  })
})
