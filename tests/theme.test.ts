import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DEFAULTS, SettingsStore } from '../src/state/settings'
import { PALETTES, ThemeController, resolveTheme } from '../src/state/theme'

beforeEach(() => localStorage.clear())

describe('resolveTheme', () => {
  it('follows the system preference on `system`', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('ignores the system preference once explicitly chosen', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('palettes', () => {
  /**
   * The light theme cannot recede by lowering alpha: on a pale ground that
   * fades a tile toward black, which reads as emphasis instead of retreat.
   */
  it('recede in the direction of each theme background', () => {
    expect(PALETTES.dark.recede).toBe('alpha')
    expect(PALETTES.light.recede).toBe('wash')
  })

  it('gives every theme a distinct background and highlight', () => {
    expect(PALETTES.light.bg).not.toBe(PALETTES.dark.bg)
    expect(PALETTES.light.highlight).not.toBe(PALETTES.dark.highlight)
  })
})

describe('ThemeController', () => {
  it('stamps the resolved theme onto its root element', () => {
    const root = document.createElement('html')
    new ThemeController(new SettingsStore({ ...DEFAULTS, theme: 'light' }), root)
    expect(root.getAttribute('data-theme')).toBe('light')
  })

  it('republishes when the setting changes', () => {
    const root = document.createElement('html')
    const settings = new SettingsStore({ ...DEFAULTS, theme: 'light' })
    const theme = new ThemeController(settings, root)

    const seen = vi.fn()
    theme.onChange(seen)
    settings.set('theme', 'dark')

    expect(theme.current).toBe('dark')
    expect(root.getAttribute('data-theme')).toBe('dark')
    expect(seen).toHaveBeenCalledWith('dark')
  })

  it('serves the palette matching the resolved theme', () => {
    const settings = new SettingsStore({ ...DEFAULTS, theme: 'light' })
    const theme = new ThemeController(settings, document.createElement('html'))
    expect(theme.palette).toBe(PALETTES.light)

    settings.set('theme', 'dark')
    expect(theme.palette).toBe(PALETTES.dark)
  })

  it('does not fire when the resolved theme is unchanged', () => {
    const settings = new SettingsStore({ ...DEFAULTS, theme: 'dark' })
    const theme = new ThemeController(settings, document.createElement('html'))
    const seen = vi.fn()
    theme.onChange(seen)

    settings.set('theme', 'system')
    // `system` may or may not resolve to dark here; what must not happen is a
    // notification claiming a change that did not occur.
    if (theme.current === 'dark') expect(seen).not.toHaveBeenCalled()
  })
})
