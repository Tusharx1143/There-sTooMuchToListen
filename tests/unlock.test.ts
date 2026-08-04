import { describe, it, expect, vi, afterEach } from 'vitest'
import { INTRO_FADE_MS, showUnlockOverlay } from '../src/audio/unlock'

afterEach(() => vi.useRealTimers())

describe('showUnlockOverlay', () => {
  it('renders the intro into the root', () => {
    const root = document.createElement('div')
    showUnlockOverlay(root, () => {})
    expect(root.querySelector('[data-unlock]')).not.toBeNull()
    expect(root.textContent).toContain('too much to listen to')
    expect(root.querySelector('[data-unlock-start]')).not.toBeNull()
  })

  /**
   * The atlas begins its reveal underneath while the overlay is still fading,
   * so the callback must not wait for the transition.
   */
  it('calls onUnlock immediately and starts fading out', () => {
    const root = document.createElement('div')
    const onUnlock = vi.fn()
    showUnlockOverlay(root, onUnlock)

    root.querySelector<HTMLElement>('[data-unlock]')!.click()

    expect(onUnlock).toHaveBeenCalledTimes(1)
    const el = root.querySelector<HTMLElement>('[data-unlock]')!
    expect(el).not.toBeNull()
    expect(el.hasAttribute('data-leaving')).toBe(true)
  })

  it('removes itself once the fade has run', () => {
    vi.useFakeTimers()
    const root = document.createElement('div')
    showUnlockOverlay(root, () => {})

    root.querySelector<HTMLElement>('[data-unlock]')!.click()
    expect(root.querySelector('[data-unlock]')).not.toBeNull()

    vi.advanceTimersByTime(INTRO_FADE_MS + 200)
    expect(root.querySelector('[data-unlock]')).toBeNull()
  })

  it('starts from the button as well as the backdrop', () => {
    const root = document.createElement('div')
    const onUnlock = vi.fn()
    showUnlockOverlay(root, onUnlock)

    root.querySelector<HTMLElement>('[data-unlock-start]')!.click()
    expect(onUnlock).toHaveBeenCalledTimes(1)
  })

  it('only fires once even if clicked twice', () => {
    const root = document.createElement('div')
    const onUnlock = vi.fn()
    showUnlockOverlay(root, onUnlock)

    const el = root.querySelector<HTMLElement>('[data-unlock]')!
    el.click()
    el.click()

    expect(onUnlock).toHaveBeenCalledTimes(1)
  })
})
