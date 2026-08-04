import type { Point } from '../atlas/hex'
import type { Song } from '../types'

/**
 * How far above the lens centre the label sits, in CSS pixels. Clear of the
 * magnified focal tile so it never covers the cover it is describing.
 */
const OFFSET_Y = 230
const OFFSET_X = 26
/** Below this much travel the label is fully out; above it, fully faded. */
const FADE_AT = 0.32
/** Per-frame follow factor for the label's own position. */
const FOLLOW = 0.18
/** Margin kept between the label and the viewport edge before it flips side. */
const EDGE = 24

/**
 * The song under the lens, shown while you browse. Deliberately not a card:
 * it is type over the atlas, and it fades out while the lens is travelling so
 * that sweeping across a hundred tiles does not strobe a hundred titles.
 */
export class HoverLabel {
  private readonly el: HTMLElement
  private readonly titleEl: HTMLElement
  private readonly metaEl: HTMLElement

  private song: Song | null = null
  private pinnedId: string | null = null
  private opacity = 0
  private at: Point | null = null
  private flipped = false

  constructor(root: HTMLElement) {
    this.el = document.createElement('div')
    this.el.className = 'hover-label'
    this.el.setAttribute('data-hover-label', '')
    this.el.setAttribute('aria-live', 'polite')

    this.titleEl = document.createElement('h2')
    this.metaEl = document.createElement('p')
    this.metaEl.className = 'hover-meta'

    this.el.append(this.titleEl, this.metaEl)
    root.appendChild(this.el)
  }

  /** The song under the lens, or null where there is nothing to name. */
  show(song: Song | null): void {
    if (song?.id === this.song?.id) return
    this.song = song
    if (!song) return

    this.titleEl.textContent = song.title
    this.metaEl.textContent = song.album ? `${song.artist} — ${song.album}` : song.artist
  }

  /**
   * The pinned song, if any. The label hides only while the lens is actually
   * over that song — the now-playing card is already naming it, and two
   * readouts of one track is one too many. Everywhere else it keeps working:
   * pinning locks the audio, it does not end the browsing session.
   */
  setPinned(songId: string | null): void {
    this.pinnedId = songId
  }

  /**
   * Called every frame. `speedScale` is the lens's travel speed, 0 parked to 1
   * at the ceiling — the label is only legible when it is near 0.
   */
  update(centre: Point, speedScale: number, viewport: { w: number; h: number }): void {
    const wants = this.song !== null && this.song.id !== this.pinnedId
    const target = wants ? 1 - Math.min(1, speedScale / FADE_AT) : 0

    this.opacity += (target - this.opacity) * FOLLOW
    if (this.opacity < 0.01) {
      if (this.el.style.opacity !== '0') {
        this.el.style.opacity = '0'
        this.el.style.visibility = 'hidden'
      }
      // Re-place it on the next appearance rather than sliding in from
      // wherever it last faded out.
      this.at = null
      return
    }

    // Flip above/below and left/right rather than let it run off screen.
    const above = centre.y - OFFSET_Y > EDGE
    this.flipped = centre.x + OFFSET_X + this.el.offsetWidth > viewport.w - EDGE
    const goal: Point = {
      x: this.flipped ? centre.x - OFFSET_X - this.el.offsetWidth : centre.x + OFFSET_X,
      y: above ? centre.y - OFFSET_Y : centre.y + OFFSET_Y - this.el.offsetHeight,
    }

    this.at = this.at
      ? { x: this.at.x + (goal.x - this.at.x) * FOLLOW, y: this.at.y + (goal.y - this.at.y) * FOLLOW }
      : goal

    const x = Math.min(Math.max(this.at.x, EDGE), viewport.w - EDGE - this.el.offsetWidth)
    const y = Math.min(Math.max(this.at.y, EDGE), viewport.h - EDGE - this.el.offsetHeight)

    this.el.style.visibility = 'visible'
    this.el.style.opacity = this.opacity.toFixed(3)
    // Scale with the fade, the way the reference does: the label grows into
    // place instead of appearing at full size.
    this.el.style.transform =
      `translate(${Math.round(x)}px, ${Math.round(y)}px) scale(${(0.94 + 0.06 * this.opacity).toFixed(3)})`
    this.el.classList.toggle('flipped', this.flipped)
  }
}
