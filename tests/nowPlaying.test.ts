import { describe, it, expect, vi } from 'vitest'
import { NowPlayingCard, STATIC_MAX_W } from '../src/ui/nowPlaying'
import type { TileAnchor } from '../src/render/canvas'
import type { Song } from '../src/types'

const song: Song = {
  id: 'a', title: 'Track Title', artist: 'Artist Name', album: 'Album Name',
  art: 'https://cdn/art.jpg', preview: 'https://cdn/p.m4a', previewType: 'aac',
  genre: 14, country: 'us', source: 'itunes',
  link: 'https://music.apple.com/x', yt: 'https://www.youtube.com/results?search_query=x',
}

const VIEW = { w: 1440, h: 900 }

function anchor(over: Partial<TileAnchor> = {}): TileAnchor {
  return { x: 700, y: 450, clear: 100, ...over }
}

function el(root: HTMLElement): HTMLElement {
  return root.querySelector<HTMLElement>('[data-now-playing]')!
}

/** The card writes its position as a transform; jsdom reports it back verbatim. */
function placed(root: HTMLElement): { x: number; y: number } {
  const m = /translate\((-?\d+)px, (-?\d+)px\)/.exec(el(root).style.transform)
  if (!m) throw new Error(`card has no position: ${el(root).style.transform}`)
  return { x: Number(m[1]), y: Number(m[2]) }
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

  it('stays put until it has somewhere to be', () => {
    const root = document.createElement('div')
    const card = new NowPlayingCard(root, () => {})
    card.show(song)
    // `show` alone must not reveal it: the transform is still unset, so the
    // card would flash at the top-left corner for a frame.
    expect(el(root).classList.contains('visible')).toBe(false)

    card.update(anchor(), VIEW)
    expect(el(root).classList.contains('visible')).toBe(true)
  })

  it('sits beside the tile it was pinned from', () => {
    const root = document.createElement('div')
    const card = new NowPlayingCard(root, () => {})
    card.show(song)
    card.update(anchor({ x: 400, y: 300, clear: 120 }), VIEW)

    const { x, y } = placed(root)
    // Clear of the magnified hex, on its right, and level with its centre.
    expect(x).toBeGreaterThan(400 + 120)
    expect(y).toBeGreaterThan(0)
    expect(el(root).classList.contains('flipped')).toBe(false)
  })

  it('flips to the other side rather than run off the edge', () => {
    const root = document.createElement('div')
    const card = new NowPlayingCard(root, () => {})
    card.show(song)
    card.update(anchor({ x: VIEW.w - 60, y: 400, clear: 120 }), VIEW)

    expect(el(root).classList.contains('flipped')).toBe(true)
    expect(placed(root).x).toBeLessThan(VIEW.w - 60)
  })

  /** Panning takes the tile off screen; the card has nothing to hang on. */
  it('parks in the corner when the tile has left the screen', () => {
    const root = document.createElement('div')
    const card = new NowPlayingCard(root, () => {})
    card.show(song)
    card.update(null, VIEW)

    const { x, y } = placed(root)
    expect(x).toBeLessThan(40)
    expect(y).toBeGreaterThan(VIEW.h - 60)
  })

  /** No room to sit beside anything on a phone. */
  it('parks in the corner on a narrow viewport', () => {
    const root = document.createElement('div')
    const card = new NowPlayingCard(root, () => {})
    card.show(song)
    card.update(anchor({ x: 200, y: 300, clear: 80 }), { w: STATIC_MAX_W, h: 700 })

    expect(placed(root).x).toBeLessThan(40)
    expect(el(root).classList.contains('flipped')).toBe(false)
  })

  it('trails the tile instead of snapping to it', () => {
    const root = document.createElement('div')
    const card = new NowPlayingCard(root, () => {})
    card.show(song)
    card.update(anchor({ x: 300, y: 300, clear: 100 }), VIEW)
    const from = placed(root).x

    card.update(anchor({ x: 900, y: 300, clear: 100 }), VIEW)
    const after = placed(root).x
    expect(after).toBeGreaterThan(from)
    expect(after).toBeLessThan(900) // nowhere near arrived yet

    for (let i = 0; i < 120; i++) card.update(anchor({ x: 900, y: 300, clear: 100 }), VIEW)
    expect(placed(root).x).toBeGreaterThan(900)
  })

  /**
   * Reaching for a link moves the lens, which moves the tile the card is
   * anchored to. Without the freeze the link walks away from the pointer that
   * is chasing it.
   */
  it('holds still while the pointer is on one of its controls', () => {
    const root = document.createElement('div')
    const card = new NowPlayingCard(root, () => {})
    card.show(song)
    card.update(anchor({ x: 300, y: 300, clear: 100 }), VIEW)
    const parked = placed(root)

    // From a control, not from the card: the card itself takes no pointer
    // events, so that hovering it still drives the lens underneath.
    const link = root.querySelector('.np-links a')!
    link.dispatchEvent(new Event('pointerover', { bubbles: true }))
    for (let i = 0; i < 120; i++) card.update(anchor({ x: 900, y: 700, clear: 100 }), VIEW)
    expect(placed(root)).toEqual(parked)

    link.dispatchEvent(new Event('pointerout', { bubbles: true }))
    for (let i = 0; i < 120; i++) card.update(anchor({ x: 900, y: 700, clear: 100 }), VIEW)
    expect(placed(root)).not.toEqual(parked)
  })

  it('goes quiet again on hide', () => {
    const root = document.createElement('div')
    const card = new NowPlayingCard(root, () => {})
    card.show(song)
    card.update(anchor(), VIEW)
    card.hide()
    expect(el(root).classList.contains('visible')).toBe(false)

    // And a stray frame afterwards must not bring it back.
    card.update(anchor(), VIEW)
    expect(el(root).classList.contains('visible')).toBe(false)
  })

  it('escapes markup in song text rather than injecting it', () => {
    const root = document.createElement('div')
    const card = new NowPlayingCard(root, () => {})
    const malicious = '<img src=x onerror=alert(1)>'
    card.show({ ...song, title: malicious })

    // Only the legitimate album-art <img> (pointing at song.art) may exist —
    // the malicious title must never be parsed into markup of its own.
    const imgs = [...root.querySelectorAll('img')]
    expect(imgs).toHaveLength(1)
    expect(imgs[0]!.src).toBe(song.art)
    expect(root.querySelector('h2')?.textContent).toBe(malicious)
  })
})
