import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DEFAULTS, SettingsStore } from '../src/state/settings'
import { ThemeController } from '../src/state/theme'
import { REPO_URL, Toolbar } from '../src/ui/toolbar'

function build(theme: 'light' | 'dark' = 'dark') {
  const root = document.createElement('div')
  const settings = new SettingsStore({ ...DEFAULTS, theme })
  const controller = new ThemeController(settings, document.createElement('html'))
  const handlers = { onAbout: vi.fn(), onSettings: vi.fn() }
  const toolbar = new Toolbar(root, settings, controller, handlers)
  return { root, settings, controller, handlers, toolbar }
}

beforeEach(() => localStorage.clear())

describe('Toolbar', () => {
  it('renders exactly four labelled controls', () => {
    const { root } = build()
    const controls = root.querySelectorAll('.tool-btn')
    expect(controls).toHaveLength(4)
    for (const c of controls) expect(c.getAttribute('aria-label')).toBeTruthy()
  })

  it('links to the source repository in a safe new tab', () => {
    const { root } = build()
    const link = root.querySelector<HTMLAnchorElement>('[data-source]')!
    expect(link.href).toBe(REPO_URL)
    expect(link.rel).toBe('noopener noreferrer')
    expect(link.target).toBe('_blank')
  })

  it('calls the handlers rather than owning panel state', () => {
    const { root, handlers } = build()
    root.querySelector<HTMLButtonElement>('[data-about]')!.click()
    root.querySelector<HTMLButtonElement>('[data-settings]')!.click()
    expect(handlers.onAbout).toHaveBeenCalledTimes(1)
    expect(handlers.onSettings).toHaveBeenCalledTimes(1)
  })

  it('reflects panel state pushed back in, so Escape un-lights the icon', () => {
    const { root, toolbar } = build()
    const about = root.querySelector<HTMLButtonElement>('[data-about]')!
    expect(about.getAttribute('aria-expanded')).toBe('false')

    toolbar.setExpanded('about', true)
    expect(about.getAttribute('aria-expanded')).toBe('true')

    toolbar.setExpanded('about', false)
    expect(about.getAttribute('aria-expanded')).toBe('false')
  })

  it('flips the theme setting to the opposite of what is on screen', () => {
    const { root, settings, controller } = build('dark')
    root.querySelector<HTMLButtonElement>('[data-theme-toggle]')!.click()
    expect(settings.current.theme).toBe('light')
    expect(controller.current).toBe('light')
  })

  /** The icon advertises the destination, not the current state. */
  it('labels the theme button with where it will take you', () => {
    const { root, settings } = build('dark')
    const btn = root.querySelector<HTMLButtonElement>('[data-theme-toggle]')!
    expect(btn.getAttribute('aria-label')).toBe('Switch to light mode')

    settings.set('theme', 'light')
    expect(btn.getAttribute('aria-label')).toBe('Switch to dark mode')
  })
})
