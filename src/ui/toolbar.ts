import type { SettingsStore } from '../state/settings'
import type { ThemeController } from '../state/theme'

/**
 * Inline so the toolbar needs no icon font or sprite request. Each is a 24-box
 * stroked path, matching the reference's line weight.
 */
const ICONS = {
  about:
    '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
} as const

function svg(paths: string): SVGSVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  el.setAttribute('viewBox', '0 0 24 24')
  el.setAttribute('fill', 'none')
  el.setAttribute('stroke', 'currentColor')
  el.setAttribute('stroke-width', '1.6')
  el.setAttribute('stroke-linecap', 'round')
  el.setAttribute('stroke-linejoin', 'round')
  el.setAttribute('aria-hidden', 'true')
  el.innerHTML = paths
  return el
}

function iconButton(label: string, paths: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'tool-btn'
  b.setAttribute('aria-label', label)
  b.appendChild(svg(paths))
  return b
}

export type ToolbarHandlers = {
  onAbout: () => void
  onSettings: () => void
}

/**
 * The three controls in the top-right corner: about, settings, theme. The
 * first two are `aria-expanded` toggles whose state the panels push back into
 * via `setExpanded`, so closing a panel by Escape still un-lights its icon.
 */
export class Toolbar {
  private readonly aboutBtn: HTMLButtonElement
  private readonly settingsBtn: HTMLButtonElement
  private readonly themeBtn: HTMLButtonElement

  constructor(
    root: HTMLElement,
    settings: SettingsStore,
    theme: ThemeController,
    handlers: ToolbarHandlers,
  ) {
    const bar = document.createElement('nav')
    bar.className = 'toolbar'
    bar.setAttribute('data-toolbar', '')
    bar.setAttribute('aria-label', 'Application controls')

    this.aboutBtn = iconButton('About', ICONS.about)
    this.aboutBtn.setAttribute('data-about', '')
    this.aboutBtn.setAttribute('aria-expanded', 'false')
    this.aboutBtn.addEventListener('click', handlers.onAbout)

    this.settingsBtn = iconButton('Settings', ICONS.settings)
    this.settingsBtn.setAttribute('data-settings', '')
    this.settingsBtn.setAttribute('aria-expanded', 'false')
    this.settingsBtn.addEventListener('click', handlers.onSettings)

    this.themeBtn = iconButton('Toggle theme', ICONS.moon)
    this.themeBtn.setAttribute('data-theme-toggle', '')
    this.themeBtn.addEventListener('click', () => {
      // Toggling from `system` commits to the opposite of what is on screen,
      // which is what someone reaching for this button is asking for.
      settings.set('theme', theme.current === 'dark' ? 'light' : 'dark')
    })

    bar.append(this.aboutBtn, this.settingsBtn, this.themeBtn)
    root.appendChild(bar)

    this.paintThemeIcon(theme.current)
    theme.onChange((t) => this.paintThemeIcon(t))
  }

  setExpanded(which: 'about' | 'settings', open: boolean): void {
    const btn = which === 'about' ? this.aboutBtn : this.settingsBtn
    btn.setAttribute('aria-expanded', String(open))
  }

  private paintThemeIcon(t: 'light' | 'dark'): void {
    // Show the destination, not the current state: a moon means "go dark".
    this.themeBtn.replaceChildren(svg(t === 'dark' ? ICONS.sun : ICONS.moon))
    this.themeBtn.setAttribute(
      'aria-label',
      t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
    )
  }
}
