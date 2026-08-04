import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Panel, anyPanelOpen, closeAllPanels } from '../src/ui/panel'

function root(): HTMLElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

beforeEach(() => {
  closeAllPanels()
  document.body.replaceChildren()
})

describe('Panel', () => {
  it('starts hidden and out of the accessibility tree', () => {
    const p = new Panel(root(), 'About')
    expect(p.isOpen).toBe(false)
    expect(p.el.hidden).toBe(true)
    expect(p.el.hasAttribute('data-open')).toBe(false)
    expect(p.el.getAttribute('role')).toBe('dialog')
  })

  it('opens and closes', () => {
    const p = new Panel(root(), 'About')
    p.show()
    expect(p.isOpen).toBe(true)
    expect(p.el.hidden).toBe(false)
    expect(p.el.hasAttribute('data-open')).toBe(true)

    p.hide()
    expect(p.isOpen).toBe(false)
    expect(p.el.hasAttribute('data-open')).toBe(false)
  })

  it('toggles', () => {
    const p = new Panel(root(), 'About')
    p.toggle()
    expect(p.isOpen).toBe(true)
    p.toggle()
    expect(p.isOpen).toBe(false)
  })

  /** Two overlays on the same corner would sit on top of each other. */
  it('closes any other panel when one opens', () => {
    const host = root()
    const about = new Panel(host, 'About')
    const settings = new Panel(host, 'Settings')

    about.show()
    settings.show()

    expect(about.isOpen).toBe(false)
    expect(settings.isOpen).toBe(true)
  })

  it('reports and clears the open set', () => {
    const p = new Panel(root(), 'About')
    expect(anyPanelOpen()).toBe(false)
    p.show()
    expect(anyPanelOpen()).toBe(true)
    closeAllPanels()
    expect(anyPanelOpen()).toBe(false)
    expect(p.isOpen).toBe(false)
  })

  it('notifies subscribers on both edges, once each', () => {
    const p = new Panel(root(), 'About')
    const seen = vi.fn()
    p.onChange(seen)

    p.show()
    p.show()
    p.hide()
    p.hide()

    expect(seen.mock.calls.map((c) => c[0])).toEqual([true, false])
  })

  it('re-hides from the DOM once the fade has run', async () => {
    vi.useFakeTimers()
    const p = new Panel(root(), 'About')
    p.show()
    p.hide()

    expect(p.el.hidden).toBe(false) // still fading
    vi.advanceTimersByTime(400)
    expect(p.el.hidden).toBe(true)
    vi.useRealTimers()
  })

  it('stays visible if it is reopened mid-fade', () => {
    vi.useFakeTimers()
    const p = new Panel(root(), 'About')
    p.show()
    p.hide()
    p.show()

    vi.advanceTimersByTime(400)
    expect(p.el.hidden).toBe(false)
    vi.useRealTimers()
  })
})
