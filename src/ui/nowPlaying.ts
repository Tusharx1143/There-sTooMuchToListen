import type { Point } from '../atlas/hex'
import type { TileAnchor } from '../render/canvas'
import type { Song } from '../types'

/** Space between the tile's outer reach and the card. */
const GAP = 24
/** Margin kept between the card and the viewport edge. */
const EDGE = 20
/** Per-frame follow factor, so the card trails the tile instead of snapping. */
const FOLLOW = 0.18
/**
 * Under this viewport width there is no "beside" to speak of — the card would
 * be wider than the space left over. It parks in the corner instead, which is
 * what the reference does on small screens too.
 */
export const STATIC_MAX_W = 760

/**
 * The pinned song. Anchored to the tile it came from and tracking it as the
 * atlas pans, rather than sitting in a fixed corner: the card is about that
 * hex, so it should read as attached to it.
 */
export class NowPlayingCard {
  private readonly el: HTMLElement

  private at: Point | null = null
  private showing = false
  private flipped = false
  private frozen = false

  constructor(root: HTMLElement, private readonly onClose: () => void) {
    this.el = document.createElement('aside')
    this.el.setAttribute('data-now-playing', '')
    this.el.className = 'now-playing'

    // Reaching for a link moves the cursor, which moves the lens, which moves
    // the tile the card is anchored to — so without this the link slides out
    // from under the pointer that is chasing it. The reference freezes its
    // drawer on mouse enter for exactly this reason.
    //
    // `pointerover`/`pointerout` rather than enter/leave: the card itself is
    // `pointer-events: none` so that hovering it still drives the lens, and an
    // element that is not a hit target never gets an enter of its own. Its
    // controls do, and those bubble through here.
    this.el.addEventListener('pointerover', () => { this.frozen = true })
    this.el.addEventListener('pointerout', () => { this.frozen = false })

    root.appendChild(this.el)
  }

  show(song: Song): void {
    this.el.replaceChildren()

    const art = document.createElement('img')
    art.src = song.art
    art.alt = ''
    art.className = 'np-art'

    const body = document.createElement('div')
    body.className = 'np-body'

    const title = document.createElement('h2')
    title.textContent = song.title            // text node: no markup injection

    const artist = document.createElement('p')
    artist.className = 'np-artist'
    artist.textContent = song.artist

    body.append(title, artist)

    if (song.album) {
      const album = document.createElement('p')
      album.className = 'np-album'
      album.textContent = song.album
      body.appendChild(album)
    }

    const links = document.createElement('div')
    links.className = 'np-links'
    links.append(
      this.link(song.yt, 'Full song on YouTube'),
      this.link(song.link, 'Store page'),
    )
    body.appendChild(links)

    const close = document.createElement('button')
    close.setAttribute('data-close', '')
    close.className = 'np-close'
    close.textContent = '×'
    close.setAttribute('aria-label', 'Unpin song')
    close.addEventListener('click', () => this.onClose())

    this.el.append(art, body, close)

    // Deliberately not revealed here: `.visible` goes on in `update`, once the
    // card has a position. Showing it first would flash it at the top-left
    // corner for the one frame before the anchor arrives.
    this.showing = true
    this.at = null
  }

  hide(): void {
    this.showing = false
    this.at = null
    // The card is about to stop existing under the pointer, and `pointerleave`
    // does not fire for an element that was removed rather than left.
    this.frozen = false
    this.el.classList.remove('visible', 'flipped')
    this.el.replaceChildren()
  }

  /**
   * Called every frame with the pinned tile's current position, or null where
   * it has panned off screen.
   */
  update(anchor: TileAnchor | null, viewport: { w: number; h: number }): void {
    if (!this.showing) return
    // Already placed and being pointed at: leave it exactly where it is.
    if (this.frozen && this.at) return

    const w = this.el.offsetWidth
    const h = this.el.offsetHeight
    const goal = this.goalFor(anchor, viewport, w, h)

    // First placement is exact; every one after it is chased.
    this.at = this.at
      ? { x: this.at.x + (goal.x - this.at.x) * FOLLOW, y: this.at.y + (goal.y - this.at.y) * FOLLOW }
      : goal

    const x = Math.min(Math.max(this.at.x, EDGE), Math.max(EDGE, viewport.w - EDGE - w))
    const y = Math.min(Math.max(this.at.y, EDGE), Math.max(EDGE, viewport.h - EDGE - h))

    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
    this.el.classList.toggle('flipped', this.flipped)
    this.el.classList.add('visible')
  }

  /**
   * The side the card wants to be on. Flips left of the tile when there is no
   * room right of it, the way the reference flips its drawer to whichever side
   * the selected cell is not on.
   */
  private goalFor(
    anchor: TileAnchor | null,
    viewport: { w: number; h: number },
    w: number,
    h: number,
  ): Point {
    if (!anchor || viewport.w <= STATIC_MAX_W) {
      this.flipped = false
      return { x: EDGE, y: viewport.h - EDGE - h }
    }

    const reach = anchor.clear + GAP
    this.flipped = anchor.x + reach + w > viewport.w - EDGE
    return {
      x: this.flipped ? anchor.x - reach - w : anchor.x + reach,
      y: anchor.y - h / 2,
    }
  }

  private link(href: string, text: string): HTMLAnchorElement {
    const a = document.createElement('a')
    a.href = href
    a.textContent = text
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    return a
  }
}
