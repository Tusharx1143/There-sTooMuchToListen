import { describe, it, expect, beforeEach } from 'vitest'
import { HoverLabel } from '../src/ui/hoverLabel'
import type { Song } from '../src/types'

function song(over: Partial<Song> = {}): Song {
  return {
    id: 'a1', title: 'Denna', artist: 'Finnegan Tui', album: 'Lost Tales',
    art: 'art', preview: 'p', previewType: 'aac', genre: 14, country: 'ae',
    source: 'itunes', link: 'l', yt: 'y',
    ...over,
  }
}

const VIEW = { w: 1440, h: 900 }
const CENTRE = { x: 700, y: 500 }

/** Runs enough frames for the eased opacity to converge. */
function settle(label: HoverLabel, speed: number, frames = 120): void {
  for (let i = 0; i < frames; i++) label.update(CENTRE, speed, VIEW)
}

function el(root: HTMLElement): HTMLElement {
  return root.querySelector<HTMLElement>('[data-hover-label]')!
}

let root: HTMLElement
beforeEach(() => {
  root = document.createElement('div')
  document.body.replaceChildren(root)
})

describe('HoverLabel', () => {
  it('starts hidden', () => {
    new HoverLabel(root)
    expect(el(root).style.opacity).toBe('')
    expect(root.textContent).toBe('')
  })

  it('names the song under the lens', () => {
    const label = new HoverLabel(root)
    label.show(song())
    expect(root.textContent).toContain('Denna')
    expect(root.textContent).toContain('Finnegan Tui')
    expect(root.textContent).toContain('Lost Tales')
  })

  it('omits the album when there is not one', () => {
    const label = new HoverLabel(root)
    label.show(song({ album: undefined }))
    expect(root.textContent).toContain('Finnegan Tui')
    expect(root.textContent).not.toContain('—')
  })

  /** The whole point: sweeping across the atlas must not strobe titles. */
  it('fades out while the lens is travelling', () => {
    const label = new HoverLabel(root)
    label.show(song())
    settle(label, 0)
    expect(Number(el(root).style.opacity)).toBeGreaterThan(0.9)

    settle(label, 1)
    expect(el(root).style.visibility).toBe('hidden')
  })

  it('fades back in once the lens parks', () => {
    const label = new HoverLabel(root)
    label.show(song())
    settle(label, 1)
    settle(label, 0)
    expect(Number(el(root).style.opacity)).toBeGreaterThan(0.9)
    expect(el(root).style.visibility).toBe('visible')
  })

  it('stays hidden with no song under the lens', () => {
    const label = new HoverLabel(root)
    settle(label, 0)
    expect(el(root).style.visibility).toBe('hidden')
  })

  /** The now-playing card already names the pinned track. */
  it('is suppressed while a song is pinned', () => {
    const label = new HoverLabel(root)
    label.show(song())
    settle(label, 0)
    expect(el(root).style.visibility).toBe('visible')

    label.suppress(true)
    settle(label, 0)
    expect(el(root).style.visibility).toBe('hidden')

    label.suppress(false)
    settle(label, 0)
    expect(el(root).style.visibility).toBe('visible')
  })

  it('keeps itself inside the viewport', () => {
    const label = new HoverLabel(root)
    label.show(song())
    for (let i = 0; i < 120; i++) label.update({ x: 10, y: 10 }, 0, VIEW)

    const m = /translate\((-?\d+)px, (-?\d+)px\)/.exec(el(root).style.transform)!
    expect(Number(m[1])).toBeGreaterThanOrEqual(0)
    expect(Number(m[2])).toBeGreaterThanOrEqual(0)
  })

  it('ignores a repeat of the song already shown', () => {
    const label = new HoverLabel(root)
    label.show(song())
    const before = el(root).innerHTML
    label.show(song())
    expect(el(root).innerHTML).toBe(before)
  })
})
