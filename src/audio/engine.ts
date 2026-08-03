import type { Song } from '../types'

/** The cursor must settle for this long before a preview starts. */
export const HOVER_DEBOUNCE_MS = 180
export const CROSSFADE_MS = 250

const FADE_STEPS = 10

/** Only the parts of HTMLAudioElement we use — keeps tests trivial to fake. */
export type AudioLike = {
  src: string
  volume: number
  muted: boolean
  currentTime: number
  play(): Promise<void>
  pause(): void
  addEventListener(type: string, cb: () => void): void
  removeEventListener(type: string, cb: () => void): void
}

type Deck = { el: AudioLike; song: Song | null }

export class AudioEngine {
  private readonly decks: [Deck, Deck]
  private active = 0
  private readonly debounceMs: number
  private readonly fadeMs: number

  private hoverTimer: ReturnType<typeof setTimeout> | null = null
  private fadeTimer: ReturnType<typeof setInterval> | null = null
  private pendingSong: Song | null = null
  private pinnedSong: Song | null = null
  private volume = 1
  private muted = false

  private readonly listeners = new Set<() => void>()

  constructor(opts: { debounceMs?: number; fadeMs?: number; make?: () => AudioLike } = {}) {
    this.debounceMs = opts.debounceMs ?? HOVER_DEBOUNCE_MS
    this.fadeMs = opts.fadeMs ?? CROSSFADE_MS

    const make = opts.make ?? (() => new Audio() as unknown as AudioLike)
    this.decks = [
      { el: make(), song: null },
      { el: make(), song: null },
    ]
    for (const deck of this.decks) {
      deck.el.volume = 0
      deck.el.muted = false
    }
  }

  get playing(): Song | null {
    return this.decks[this.active]!.song
  }

  get pinned(): Song | null {
    return this.pinnedSong
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  hover(song: Song | null): void {
    if (this.pinnedSong) return // a pinned song owns the audio

    this.clearHoverTimer()
    this.pendingSong = song

    if (song === null) return
    if (this.playing?.id === song.id) return

    this.hoverTimer = setTimeout(() => {
      this.hoverTimer = null
      const next = this.pendingSong
      if (next && this.playing?.id !== next.id) this.start(next)
    }, this.debounceMs)
  }

  pin(song: Song): void {
    this.clearHoverTimer()
    this.pinnedSong = song
    if (this.playing?.id !== song.id) this.start(song)
    else this.emit()
  }

  unpin(): void {
    this.pinnedSong = null
    this.emit()
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v))
    this.decks[this.active]!.el.volume = this.volume
    this.decks[1 - this.active]!.el.volume = Math.min(
      this.decks[1 - this.active]!.el.volume,
      this.volume,
    )
    this.emit()
  }

  setMuted(m: boolean): void {
    this.muted = m
    for (const deck of this.decks) deck.el.muted = m
    this.emit()
  }

  dispose(): void {
    this.clearHoverTimer()
    if (this.fadeTimer !== null) clearInterval(this.fadeTimer)
    for (const deck of this.decks) deck.el.pause()
    this.listeners.clear()
  }

  private start(song: Song): void {
    const outgoing = this.decks[this.active]!
    const incomingIndex = 1 - this.active
    const incoming = this.decks[incomingIndex]!

    incoming.el.src = song.preview
    incoming.el.currentTime = 0
    incoming.el.muted = this.muted
    incoming.el.volume = 0
    incoming.song = song

    void incoming.el.play().catch(() => {
      // Autoplay blocked or a dead preview URL: leave the tile silent
      // rather than throwing. src/audio/unlock.ts handles the first case.
      incoming.song = null
      this.emit()
    })

    this.active = incomingIndex
    this.crossfade(incoming.el, outgoing.el)
    this.emit()
  }

  private crossfade(incoming: AudioLike, outgoing: AudioLike): void {
    if (this.fadeTimer !== null) clearInterval(this.fadeTimer)

    const stepMs = Math.max(1, Math.floor(this.fadeMs / FADE_STEPS))
    const startOut = outgoing.volume
    let step = 0

    this.fadeTimer = setInterval(() => {
      step++
      const t = Math.min(1, step / FADE_STEPS)
      incoming.volume = this.volume * t
      outgoing.volume = startOut * (1 - t)

      if (t >= 1) {
        if (this.fadeTimer !== null) clearInterval(this.fadeTimer)
        this.fadeTimer = null
        outgoing.pause()
      }
    }, stepMs)
  }

  private clearHoverTimer(): void {
    if (this.hoverTimer !== null) {
      clearTimeout(this.hoverTimer)
      this.hoverTimer = null
    }
  }

  private emit(): void {
    for (const cb of this.listeners) cb()
  }
}
