import type { AudioEngine } from '../audio/engine'

const KEY = 'lta:prefs'

export type Prefs = { volume: number; muted: boolean }

const DEFAULTS: Prefs = { volume: 1, muted: false }

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<Prefs>
    const volume = typeof parsed.volume === 'number' ? Math.min(1, Math.max(0, parsed.volume)) : 1
    return { volume, muted: parsed.muted === true }
  } catch {
    return { ...DEFAULTS }
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // Private browsing can reject writes; preferences are not worth failing over.
  }
}

export class VolumeControl {
  constructor(root: HTMLElement, engine: AudioEngine) {
    const prefs = loadPrefs()
    engine.setVolume(prefs.volume)
    engine.setMuted(prefs.muted)

    const wrap = document.createElement('div')
    wrap.className = 'volume'

    const mute = document.createElement('button')
    mute.setAttribute('data-mute', '')
    mute.textContent = prefs.muted ? '🔇' : '🔊'
    mute.setAttribute('aria-label', 'Mute')

    const slider = document.createElement('input')
    slider.type = 'range'
    slider.min = '0'
    slider.max = '1'
    slider.step = '0.01'
    slider.value = String(prefs.volume)
    slider.setAttribute('data-volume', '')

    const persist = (): void =>
      savePrefs({ volume: Number(slider.value), muted: mute.textContent === '🔇' })

    slider.addEventListener('input', () => {
      engine.setVolume(Number(slider.value))
      persist()
    })

    mute.addEventListener('click', () => {
      const nowMuted = mute.textContent === '🔊'
      mute.textContent = nowMuted ? '🔇' : '🔊'
      engine.setMuted(nowMuted)
      persist()
    })

    wrap.append(mute, slider)
    root.appendChild(wrap)
  }
}
