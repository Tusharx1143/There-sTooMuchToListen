import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AudioEngine, type AudioLike } from '../src/audio/engine'
import { DEFAULTS, SettingsStore } from '../src/state/settings'
import { AboutPanel } from '../src/ui/aboutPanel'
import { SettingsPanel } from '../src/ui/settingsPanel'
import { closeAllPanels } from '../src/ui/panel'

function fakeAudio(): AudioEngine {
  const make = (): AudioLike => ({
    src: '', volume: 0, muted: false, currentTime: 0,
    play: async () => {}, pause: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
  })
  return new AudioEngine({ make })
}

function build(initial = DEFAULTS) {
  const root = document.createElement('div')
  const settings = new SettingsStore({ ...initial })
  const audio = fakeAudio()
  const panel = new SettingsPanel(root, settings, audio)
  return { root, settings, audio, panel }
}

beforeEach(() => {
  closeAllPanels()
  localStorage.clear()
})

describe('SettingsPanel', () => {
  it('marks the stored option as pressed', () => {
    const { root } = build({ ...DEFAULTS, tileSize: 'large' })
    const large = root.querySelector('[data-option="large"]')!
    const small = root.querySelector('[data-option="small"]')!
    expect(large.getAttribute('aria-pressed')).toBe('true')
    expect(small.getAttribute('aria-pressed')).toBe('false')
  })

  it('writes an option choice into the store', () => {
    const { root, settings } = build()
    root.querySelector<HTMLButtonElement>('[data-option="subtle"]')!.click()
    expect(settings.current.lens).toBe('subtle')
  })

  it('repaints when the store changes from elsewhere', () => {
    const { root, settings } = build()
    settings.set('tileSize', 'small')
    expect(root.querySelector('[data-option="small"]')!.getAttribute('aria-pressed')).toBe('true')
  })

  it('drives the audio engine from the volume and mute controls', () => {
    const { root, settings, audio } = build()
    const setVolume = vi.spyOn(audio, 'setVolume')
    const setMuted = vi.spyOn(audio, 'setMuted')

    const slider = root.querySelector<HTMLInputElement>('[data-volume]')!
    slider.value = '0.4'
    slider.dispatchEvent(new Event('input'))
    expect(settings.current.volume).toBeCloseTo(0.4)
    expect(setVolume).toHaveBeenCalledWith(0.4)

    const mute = root.querySelector<HTMLInputElement>('[data-mute]')!
    mute.checked = true
    mute.dispatchEvent(new Event('change'))
    expect(settings.current.muted).toBe(true)
    expect(setMuted).toHaveBeenCalledWith(true)
  })

  it('applies the stored audio preferences on construction', () => {
    const root = document.createElement('div')
    const audio = fakeAudio()
    const setVolume = vi.spyOn(audio, 'setVolume')
    new SettingsPanel(root, new SettingsStore({ ...DEFAULTS, volume: 0.2 }), audio)
    expect(setVolume).toHaveBeenCalledWith(0.2)
  })

  it('shows the field light as a percentage', () => {
    const { root } = build({ ...DEFAULTS, fieldLight: 0.7 })
    expect(root.querySelector('output')!.textContent).toBe('70%')
  })

  it('closes itself from its own Close button', () => {
    const { root, panel } = build()
    panel.panel.show()
    expect(panel.panel.isOpen).toBe(true)

    const close = [...root.querySelectorAll<HTMLButtonElement>('.btn')].find(
      (b) => b.textContent === 'Close',
    )!
    close.click()
    expect(panel.panel.isOpen).toBe(false)
  })
})

describe('AboutPanel', () => {
  it('renders one accordion item per section', () => {
    const root = document.createElement('div')
    new AboutPanel(root)
    expect(root.querySelectorAll('.acc-item').length).toBeGreaterThanOrEqual(3)
  })

  it('opens the first section by default and toggles on click', async () => {
    const root = document.createElement('div')
    new AboutPanel(root)
    await Promise.resolve() // the initial height is set in a microtask

    const first = root.querySelector<HTMLButtonElement>('.acc-trigger')!
    expect(first.getAttribute('aria-expanded')).toBe('true')

    first.click()
    expect(first.getAttribute('aria-expanded')).toBe('false')
    first.click()
    expect(first.getAttribute('aria-expanded')).toBe('true')
  })

  it('mentions the harvest date when there is one', () => {
    const root = document.createElement('div')
    new AboutPanel(root, '2026-01-15T00:00:00.000Z')
    expect(root.textContent).toContain('Catalogue harvested')
  })

  it('omits the harvest line when there is none', () => {
    const root = document.createElement('div')
    new AboutPanel(root)
    expect(root.textContent).not.toContain('Catalogue harvested')
  })

  /** The chrome links out nowhere; the credits name the sources in prose. */
  it('carries no source link', () => {
    const root = document.createElement('div')
    new AboutPanel(root, '2026-01-15T00:00:00.000Z')
    expect(root.querySelector('a')).toBeNull()
    expect(root.textContent).not.toContain('GitHub')
  })
})
