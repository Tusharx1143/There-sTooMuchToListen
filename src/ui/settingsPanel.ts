import type { AudioEngine } from '../audio/engine'
import { Panel } from './panel'
import type { LensPreset, Settings, SettingsStore, TileSize } from '../state/settings'

function group(title: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'set-group'
  const h = document.createElement('h2')
  h.textContent = title
  el.appendChild(h)
  return el
}

/**
 * A row of mutually exclusive options. Reflects the store rather than owning
 * the state, so a change from anywhere else repaints the pressed option.
 */
function optionRow<T extends string>(
  options: readonly { value: T; label: string }[],
  get: () => T,
  set: (v: T) => void,
): { el: HTMLElement; sync: () => void } {
  const row = document.createElement('div')
  row.className = 'opt-row'
  const buttons = new Map<T, HTMLButtonElement>()

  for (const o of options) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'opt'
    b.textContent = o.label
    b.setAttribute('data-option', o.value)
    b.addEventListener('click', () => set(o.value))
    buttons.set(o.value, b)
    row.appendChild(b)
  }

  const sync = (): void => {
    const active = get()
    for (const [value, b] of buttons) b.setAttribute('aria-pressed', String(value === active))
  }
  sync()
  return { el: row, sync }
}

function slider(
  label: string,
  attr: string,
  get: () => number,
  set: (v: number) => void,
): { el: HTMLElement; sync: () => void } {
  const wrap = document.createElement('div')
  wrap.className = 'set-slider'

  const input = document.createElement('input')
  input.type = 'range'
  input.min = '0'
  input.max = '1'
  input.step = '0.01'
  input.setAttribute(attr, '')

  const id = `set-${attr}`
  input.id = id
  const name = document.createElement('label')
  name.textContent = label
  name.htmlFor = id

  const out = document.createElement('output')

  const paint = (): void => {
    input.value = String(get())
    out.textContent = `${Math.round(get() * 100)}%`
  }
  input.addEventListener('input', () => set(Number(input.value)))
  paint()

  wrap.append(name, input, out)
  return { el: wrap, sync: paint }
}

function toggle(
  label: string,
  attr: string,
  get: () => boolean,
  set: (v: boolean) => void,
): { el: HTMLElement; sync: () => void } {
  const wrap = document.createElement('label')
  wrap.className = 'switch'

  const input = document.createElement('input')
  input.type = 'checkbox'
  input.setAttribute(attr, '')
  input.addEventListener('change', () => set(input.checked))

  const track = document.createElement('span')
  track.className = 'switch-track'

  const text = document.createElement('span')
  text.textContent = label

  wrap.append(input, track, text)
  const sync = (): void => {
    input.checked = get()
  }
  sync()
  return { el: wrap, sync }
}

const LENS_OPTIONS: readonly { value: LensPreset; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'subtle', label: 'Subtle' },
  { value: 'strong', label: 'Strong' },
]

const TILE_OPTIONS: readonly { value: TileSize; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
]

export class SettingsPanel {
  readonly panel: Panel

  constructor(root: HTMLElement, settings: SettingsStore, audio: AudioEngine) {
    this.panel = new Panel(root, 'Settings')

    const s = (): Readonly<Settings> => settings.current

    const lens = optionRow(LENS_OPTIONS, () => s().lens, (v) => settings.set('lens', v))
    const tiles = optionRow(TILE_OPTIONS, () => s().tileSize, (v) => settings.set('tileSize', v))
    const light = slider('Field light', 'data-field-light', () => s().fieldLight, (v) =>
      settings.set('fieldLight', v),
    )
    const volume = slider('Volume', 'data-volume', () => s().volume, (v) =>
      settings.set('volume', v),
    )
    const muted = toggle('Mute', 'data-mute', () => s().muted, (v) => settings.set('muted', v))
    const fullscreen = toggle(
      'Fullscreen',
      'data-fullscreen',
      () => document.fullscreenElement !== null,
      (v) => {
        // Rejected when the click that got us here is no longer the activating
        // gesture; there is nothing useful to do about it but stay consistent.
        const done = v ? document.documentElement.requestFullscreen?.() : document.exitFullscreen?.()
        void Promise.resolve(done).catch(() => fullscreen.sync())
      },
    )

    const lensGroup = group('Lens')
    lensGroup.appendChild(lens.el)

    const tileGroup = group('Tile size')
    tileGroup.appendChild(tiles.el)

    const displayGroup = group('Display')
    displayGroup.append(light.el)

    const audioGroup = group('Audio')
    audioGroup.append(volume.el)

    const switches = document.createElement('div')
    switches.className = 'switch-row'
    switches.append(muted.el, fullscreen.el)

    const actions = document.createElement('div')
    actions.className = 'panel-actions'
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'btn'
    close.textContent = 'Close'
    close.addEventListener('click', () => this.panel.hide())
    actions.appendChild(close)

    this.panel.el.append(lensGroup, tileGroup, displayGroup, audioGroup, switches, actions)

    // The audio engine is the one consumer that cannot read the store itself.
    audio.setVolume(s().volume)
    audio.setMuted(s().muted)
    settings.onChange((next, changed) => {
      if (changed === 'volume') audio.setVolume(next.volume)
      if (changed === 'muted') audio.setMuted(next.muted)
      for (const c of [lens, tiles, light, volume, muted]) c.sync()
    })

    document.addEventListener('fullscreenchange', () => fullscreen.sync())
  }
}
