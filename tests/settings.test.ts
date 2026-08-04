import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DEFAULTS,
  HEX_SIZE_BY_TILE,
  LENS_K_BY_PRESET,
  SettingsStore,
  loadSettings,
  saveSettings,
} from '../src/state/settings'

beforeEach(() => localStorage.clear())

describe('loadSettings', () => {
  it('returns the defaults with nothing stored', () => {
    expect(loadSettings()).toEqual(DEFAULTS)
  })

  it('round-trips a saved profile', () => {
    const saved = {
      ...DEFAULTS,
      lens: 'subtle' as const,
      tileSize: 'large' as const,
      fieldLight: 0.4,
      volume: 0.25,
      muted: true,
      theme: 'light' as const,
    }
    saveSettings(saved)
    expect(loadSettings()).toEqual(saved)
  })

  it('falls back to defaults on unparseable JSON', () => {
    localStorage.setItem('lta:prefs', 'not json')
    expect(loadSettings()).toEqual(DEFAULTS)
  })

  it('clamps corrupt numbers back into range', () => {
    localStorage.setItem('lta:prefs', JSON.stringify({ volume: 99, fieldLight: -5 }))
    const s = loadSettings()
    expect(s.volume).toBe(1)
    expect(s.fieldLight).toBe(0)
  })

  it('rejects an unknown enum value rather than passing it through', () => {
    localStorage.setItem('lta:prefs', JSON.stringify({ lens: 'nuclear', theme: 'sepia' }))
    const s = loadSettings()
    expect(s.lens).toBe(DEFAULTS.lens)
    expect(s.theme).toBe(DEFAULTS.theme)
  })

  /**
   * The key predates this module: the old build stored only these two fields.
   * A returning user must keep their audio preferences.
   */
  it('reads a profile written by the older volume-only build', () => {
    localStorage.setItem('lta:prefs', JSON.stringify({ volume: 0.3, muted: true }))
    const s = loadSettings()
    expect(s.volume).toBe(0.3)
    expect(s.muted).toBe(true)
    expect(s.tileSize).toBe(DEFAULTS.tileSize)
  })
})

describe('SettingsStore', () => {
  it('exposes derived render values', () => {
    const store = new SettingsStore({ ...DEFAULTS, lens: 'subtle', tileSize: 'small' })
    expect(store.lensK).toBe(LENS_K_BY_PRESET.subtle)
    expect(store.hexSize).toBe(HEX_SIZE_BY_TILE.small)
  })

  /**
   * `minimal` is the reference's own default, and its whole preset is
   * `{ cells, media }` — the engine with post-processing off. Ours matches by
   * carrying no relief at all.
   */
  it('defaults to the minimal preset, which adds nothing', () => {
    expect(DEFAULTS.preset).toBe('minimal')
    expect(new SettingsStore({ ...DEFAULTS }).relief).toBe(0)
  })

  it('gives the depth preset relief to draw', () => {
    expect(new SettingsStore({ ...DEFAULTS, preset: 'depth' }).relief).toBeGreaterThan(0)
  })

  it('notifies listeners with the key that changed', () => {
    const store = new SettingsStore({ ...DEFAULTS })
    const seen = vi.fn()
    store.onChange(seen)

    store.set('tileSize', 'large')
    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen.mock.calls[0]![1]).toBe('tileSize')
    expect(seen.mock.calls[0]![0].tileSize).toBe('large')
  })

  it('stays silent when the value is unchanged', () => {
    const store = new SettingsStore({ ...DEFAULTS, muted: false })
    const seen = vi.fn()
    store.onChange(seen)

    store.set('muted', false)
    expect(seen).not.toHaveBeenCalled()
  })

  it('persists every change', () => {
    const store = new SettingsStore({ ...DEFAULTS })
    store.set('theme', 'light')
    expect(loadSettings().theme).toBe('light')
  })

  it('stops notifying after unsubscribe', () => {
    const store = new SettingsStore({ ...DEFAULTS })
    const seen = vi.fn()
    store.onChange(seen)()
    store.set('theme', 'light')
    expect(seen).not.toHaveBeenCalled()
  })
})
