import type { SettingsStore, ThemeChoice } from './settings'

export type ResolvedTheme = 'light' | 'dark'

/**
 * The canvas is most of the app, so a theme is not just CSS: the renderer needs
 * its own colours too, and it needs them as concrete strings rather than custom
 * properties it would have to resolve per frame.
 */
export type Palette = {
  /** Canvas background behind the hex field. */
  bg: string
  /** Colour of a hex whose cell has not arrived. */
  gap: string
  /** HSL lightness for the hashed speckle shown while a cell loads. */
  speckleLightness: number
  /**
   * How an unlit tile recedes. Dark themes fade toward black, which alpha does
   * for free. Light themes must fade toward a *pale* background, so they wash
   * the tile with `bg` instead — same knob, opposite direction.
   */
  recede: 'alpha' | 'wash'
  /** Outline on the focal tile. */
  highlight: string
  /**
   * The minimap is a second canvas and cannot inherit the CSS tokens. Its
   * ground must be fully opaque: at anything less the atlas shows through and
   * album art reads as noise inside the map.
   */
  minimap: { bg: string; band: string; view: string }
}

export const PALETTES: Record<ResolvedTheme, Palette> = {
  dark: {
    bg: '#0a0a0a',
    gap: '#0b0b12',
    speckleLightness: 22,
    recede: 'alpha',
    highlight: '#ffffff',
    minimap: { bg: '#121216', band: 'rgba(255,255,255,.06)', view: '#ff7a45' },
  },
  light: {
    // The warm neutral the reference uses — a plain white ground makes album
    // art look like it is floating on paper.
    bg: 'hsl(30, 13%, 64%)',
    gap: 'hsl(30, 13%, 58%)',
    // Loading cells must sit just under the ground, not punch dark holes in it.
    speckleLightness: 58,
    recede: 'wash',
    highlight: '#1a1a1a',
    minimap: { bg: 'hsl(30, 14%, 78%)', band: 'rgba(0,0,0,.07)', view: '#a8380c' },
  },
}

export function prefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveTheme(choice: ThemeChoice, systemIsDark: boolean = prefersDark()): ResolvedTheme {
  if (choice === 'system') return systemIsDark ? 'dark' : 'light'
  return choice
}

/**
 * Applies the resolved theme to the document and republishes it whenever the
 * setting or — while on `system` — the OS preference changes.
 */
export class ThemeController {
  private resolved: ResolvedTheme
  private readonly listeners = new Set<(t: ResolvedTheme) => void>()

  constructor(
    private readonly settings: SettingsStore,
    private readonly root: HTMLElement = document.documentElement,
  ) {
    this.resolved = resolveTheme(settings.current.theme)
    this.apply()

    this.settings.onChange((s, changed) => {
      if (changed === 'theme') this.update(resolveTheme(s.theme))
    })

    if (typeof matchMedia === 'function') {
      const mq = matchMedia('(prefers-color-scheme: dark)')
      // Only meaningful on `system`; resolveTheme ignores it otherwise.
      const onSystem = (): void => this.update(resolveTheme(this.settings.current.theme))
      if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onSystem)
    }
  }

  get current(): ResolvedTheme {
    return this.resolved
  }

  get palette(): Palette {
    return PALETTES[this.resolved]
  }

  onChange(cb: (t: ResolvedTheme) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private update(next: ResolvedTheme): void {
    if (next === this.resolved) return
    this.resolved = next
    this.apply()
    for (const cb of this.listeners) cb(next)
  }

  private apply(): void {
    this.root.setAttribute('data-theme', this.resolved)
  }
}
