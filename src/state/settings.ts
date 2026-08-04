/**
 * Live user settings, persisted to localStorage. Everything that used to be a
 * render constant and is now adjustable reads its value from here.
 *
 * The storage key predates this module — it held `{ volume, muted }` for the
 * old volume pill. Unknown fields fall back to defaults, so a profile written
 * by the older build still loads with its audio preferences intact.
 */

const KEY = 'lta:prefs'

export type LensPreset = 'off' | 'subtle' | 'strong'
export type TileSize = 'small' | 'medium' | 'large'
export type ThemeChoice = 'system' | 'light' | 'dark'

export type Settings = {
  lens: LensPreset
  tileSize: TileSize
  /** 0..1, drives the undistorted field's brightness floor. */
  fieldLight: number
  volume: number
  muted: boolean
  theme: ThemeChoice
}

export const DEFAULTS: Settings = {
  lens: 'strong',
  tileSize: 'medium',
  fieldLight: 0.7,
  volume: 1,
  muted: false,
  theme: 'system',
}

/** Peak magnification is k + 1, so `off` really is an identity transform. */
export const LENS_K_BY_PRESET: Record<LensPreset, number> = {
  off: 0,
  subtle: 1,
  strong: 2,
}

/** Hex centre-to-corner distance in CSS pixels, per preset. */
export const HEX_SIZE_BY_TILE: Record<TileSize, number> = {
  small: 40,
  medium: 56,
  large: 76,
}

const LENS_PRESETS: readonly LensPreset[] = ['off', 'subtle', 'strong']
const TILE_SIZES: readonly TileSize[] = ['small', 'medium', 'large']
const THEMES: readonly ThemeChoice[] = ['system', 'light', 'dark']

function clamp01(n: unknown, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const p = JSON.parse(raw) as Partial<Settings>
    return {
      lens: oneOf(p.lens, LENS_PRESETS, DEFAULTS.lens),
      tileSize: oneOf(p.tileSize, TILE_SIZES, DEFAULTS.tileSize),
      fieldLight: clamp01(p.fieldLight, DEFAULTS.fieldLight),
      volume: clamp01(p.volume, DEFAULTS.volume),
      muted: p.muted === true,
      theme: oneOf(p.theme, THEMES, DEFAULTS.theme),
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // Private browsing can reject writes; preferences are not worth failing over.
  }
}

export class SettingsStore {
  private state: Settings
  private readonly listeners = new Set<(s: Settings, changed: keyof Settings) => void>()

  constructor(initial: Settings = loadSettings()) {
    this.state = initial
  }

  get current(): Readonly<Settings> {
    return this.state
  }

  get lensK(): number {
    return LENS_K_BY_PRESET[this.state.lens]
  }

  get hexSize(): number {
    return HEX_SIZE_BY_TILE[this.state.tileSize]
  }

  onChange(cb: (s: Settings, changed: keyof Settings) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** No-ops when the value is unchanged, so listeners never fire spuriously. */
  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    if (this.state[key] === value) return
    this.state = { ...this.state, [key]: value }
    saveSettings(this.state)
    for (const cb of this.listeners) cb(this.state, key)
  }
}
