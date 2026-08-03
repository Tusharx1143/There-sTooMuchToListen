import { describe, it, expect, beforeEach } from 'vitest'
import { loadPrefs, savePrefs } from '../src/ui/volume'

beforeEach(() => localStorage.clear())

describe('preferences', () => {
  it('defaults to full volume, unmuted', () => {
    expect(loadPrefs()).toEqual({ volume: 1, muted: false })
  })

  it('round-trips a saved preference', () => {
    savePrefs({ volume: 0.35, muted: true })
    expect(loadPrefs()).toEqual({ volume: 0.35, muted: true })
  })

  it('clamps a corrupt volume back into range', () => {
    localStorage.setItem('lta:prefs', JSON.stringify({ volume: 99, muted: false }))
    expect(loadPrefs().volume).toBe(1)
  })

  it('falls back to defaults on unparseable JSON', () => {
    localStorage.setItem('lta:prefs', 'not json')
    expect(loadPrefs()).toEqual({ volume: 1, muted: false })
  })
})
