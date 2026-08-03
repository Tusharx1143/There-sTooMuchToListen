import type { Offset } from '../atlas/hex'
import type { AtlasLayout } from '../atlas/layout'
import type { GenreId } from '../types'

/** Uses the platform's own country-name table — no list to maintain. */
const countryNames = new Intl.DisplayNames(['en'], { type: 'region' })

export function countryName(code: string): string {
  try {
    return countryNames.of(code.toUpperCase()) ?? code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}

export class AxisHud {
  private readonly el: HTMLElement

  constructor(
    root: HTMLElement,
    private readonly layout: AtlasLayout,
    private readonly genreLabels: Map<GenreId, string>,
  ) {
    this.el = document.createElement('div')
    this.el.className = 'axis-hud'
    this.el.setAttribute('data-axis-hud', '')
    root.appendChild(this.el)
  }

  update(o: Offset | null): void {
    if (o === null) return // keep the last known position rather than blanking
    const slot = this.layout.slotAt(o)
    if (!slot) return

    this.el.innerHTML = `
      <span class="axis-country">${countryName(slot.country)}</span>
      <span class="axis-sep">·</span>
      <span class="axis-genre">${this.genreLabels.get(slot.genre) ?? slot.genre}</span>
    `
  }
}
