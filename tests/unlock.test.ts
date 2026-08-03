import { describe, it, expect, vi } from 'vitest'
import { showUnlockOverlay } from '../src/audio/unlock'

describe('showUnlockOverlay', () => {
  it('renders an overlay into the root', () => {
    const root = document.createElement('div')
    showUnlockOverlay(root, () => {})
    expect(root.querySelector('[data-unlock]')).not.toBeNull()
  })

  it('calls onUnlock and removes itself when clicked', () => {
    const root = document.createElement('div')
    const onUnlock = vi.fn()
    showUnlockOverlay(root, onUnlock)

    root.querySelector<HTMLElement>('[data-unlock]')!.click()

    expect(onUnlock).toHaveBeenCalledTimes(1)
    expect(root.querySelector('[data-unlock]')).toBeNull()
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
