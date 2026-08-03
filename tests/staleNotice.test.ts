import { describe, it, expect } from 'vitest'
import { isStale, showStaleNotice, STALE_AFTER_DAYS } from '../src/ui/staleNotice'

const now = new Date('2026-08-03T00:00:00Z')

describe('isStale', () => {
  it('is false for a fresh harvest', () => {
    expect(isStale('2026-08-01T00:00:00Z', now)).toBe(false)
  })

  it('is true past the threshold', () => {
    expect(isStale('2026-01-01T00:00:00Z', now)).toBe(true)
  })

  it('is false exactly at the threshold', () => {
    const at = new Date(now.getTime() - STALE_AFTER_DAYS * 86_400_000).toISOString()
    expect(isStale(at, now)).toBe(false)
  })

  it('treats an unparseable date as stale', () => {
    expect(isStale('not a date', now)).toBe(true)
  })
})

describe('showStaleNotice', () => {
  it('adds a notice when stale', () => {
    const root = document.createElement('div')
    showStaleNotice(root, '2026-01-01T00:00:00Z')
    expect(root.querySelector('[data-stale]')).not.toBeNull()
  })

  it('adds nothing when fresh', () => {
    const root = document.createElement('div')
    showStaleNotice(root, new Date().toISOString())
    expect(root.querySelector('[data-stale]')).toBeNull()
  })
})
