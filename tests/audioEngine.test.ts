import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AudioEngine, HOVER_DEBOUNCE_MS, type AudioLike } from '../src/audio/engine'
import type { Song } from '../src/types'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function song(id: string): Song {
  return {
    id, title: `T${id}`, artist: `A${id}`, art: 'art', preview: `https://cdn/${id}.m4a`,
    previewType: 'aac', genre: 14, country: 'us', source: 'itunes', link: 'l', yt: 'y',
  }
}

function fakeAudioFactory() {
  const made: AudioLike[] = []
  const make = (): AudioLike => {
    const el = {
      src: '', volume: 1, muted: false, currentTime: 0,
      play: vi.fn(async () => {}),
      pause: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as AudioLike
    made.push(el)
    return el
  }
  return { make, made }
}

describe('AudioEngine hover debounce', () => {
  it('does not play until the cursor settles', () => {
    const { make, made } = fakeAudioFactory()
    const engine = new AudioEngine({ make })

    engine.hover(song('a'))
    expect(made.every((el) => (el.play as any).mock.calls.length === 0)).toBe(true)

    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS)
    expect(made.some((el) => (el.play as any).mock.calls.length === 1)).toBe(true)
  })

  it('a hover storm produces exactly one play', () => {
    const { make, made } = fakeAudioFactory()
    const engine = new AudioEngine({ make })

    for (let i = 0; i < 40; i++) {
      engine.hover(song(`s${i}`))
      vi.advanceTimersByTime(10) // well under the debounce
    }
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS)

    const plays = made.reduce((n, el) => n + (el.play as any).mock.calls.length, 0)
    expect(plays).toBe(1)
  })

  it('plays the last song hovered, not the first', () => {
    const { make, made } = fakeAudioFactory()
    const engine = new AudioEngine({ make })

    engine.hover(song('first'))
    vi.advanceTimersByTime(50)
    engine.hover(song('last'))
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS)

    expect(engine.playing?.id).toBe('last')
    expect(made.some((el) => el.src.includes('last'))).toBe(true)
  })

  it('hovering nothing cancels a pending play', () => {
    const { make, made } = fakeAudioFactory()
    const engine = new AudioEngine({ make })

    engine.hover(song('a'))
    engine.hover(null)
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS * 2)

    const plays = made.reduce((n, el) => n + (el.play as any).mock.calls.length, 0)
    expect(plays).toBe(0)
  })

  it('re-hovering the song already playing does not restart it', () => {
    const { make, made } = fakeAudioFactory()
    const engine = new AudioEngine({ make })

    engine.hover(song('a'))
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS)
    engine.hover(song('a'))
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS)

    const plays = made.reduce((n, el) => n + (el.play as any).mock.calls.length, 0)
    expect(plays).toBe(1)
  })
})

describe('AudioEngine crossfade', () => {
  it('alternates between two elements and never creates more', () => {
    const { make, made } = fakeAudioFactory()
    const engine = new AudioEngine({ make })

    engine.hover(song('a'))
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS + 400)
    engine.hover(song('b'))
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS + 400)
    engine.hover(song('c'))
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS + 400)

    expect(made).toHaveLength(2)
  })

  it('ramps the outgoing element down and pauses it', () => {
    const { make, made } = fakeAudioFactory()
    const engine = new AudioEngine({ make, fadeMs: 100 })

    engine.hover(song('a'))
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS)
    const first = made.find((el) => el.src.includes('a'))!

    engine.hover(song('b'))
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS + 200)

    expect((first.pause as any).mock.calls.length).toBeGreaterThan(0)
  })
})

describe('AudioEngine pinning', () => {
  it('pinning keeps a song playing while hovering elsewhere', () => {
    const { make } = fakeAudioFactory()
    const engine = new AudioEngine({ make })

    engine.pin(song('pinned'))
    engine.hover(song('other'))
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS * 3)

    expect(engine.pinned?.id).toBe('pinned')
    expect(engine.playing?.id).toBe('pinned')
  })

  it('unpinning lets hover take over again', () => {
    const { make } = fakeAudioFactory()
    const engine = new AudioEngine({ make })

    engine.pin(song('pinned'))
    engine.unpin()
    engine.hover(song('other'))
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS)

    expect(engine.pinned).toBeNull()
    expect(engine.playing?.id).toBe('other')
  })
})

describe('AudioEngine volume', () => {
  it('applies volume to both elements', () => {
    const { make, made } = fakeAudioFactory()
    const engine = new AudioEngine({ make })
    engine.setVolume(0.4)
    expect(made.length).toBeGreaterThan(0)
    for (const el of made) expect(el.volume).toBeLessThanOrEqual(0.4)
  })

  it('clamps volume into 0..1', () => {
    const { make, made } = fakeAudioFactory()
    const engine = new AudioEngine({ make })
    engine.setVolume(5)
    for (const el of made) expect(el.volume).toBeLessThanOrEqual(1)
  })

  it('mutes both elements', () => {
    const { make, made } = fakeAudioFactory()
    const engine = new AudioEngine({ make })
    engine.setMuted(true)
    for (const el of made) expect(el.muted).toBe(true)
  })
})

describe('AudioEngine notifications', () => {
  it('notifies subscribers when the playing song changes', () => {
    const { make } = fakeAudioFactory()
    const engine = new AudioEngine({ make })
    const cb = vi.fn()
    engine.onChange(cb)

    engine.hover(song('a'))
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS)
    expect(cb).toHaveBeenCalled()
  })
})
