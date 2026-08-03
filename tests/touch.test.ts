import { describe, it, expect, vi } from 'vitest'
import { attachTouch } from '../src/input/touch'

function pointerEvent(type: string, x: number, y: number): PointerEvent {
  return new PointerEvent(type, {
    clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', bubbles: true,
  })
}

describe('attachTouch', () => {
  it('treats a short press as a tap', () => {
    const canvas = document.createElement('canvas')
    canvas.setPointerCapture = vi.fn()
    canvas.releasePointerCapture = vi.fn()
    const onTap = vi.fn()
    attachTouch(canvas, { onTap, onPan: vi.fn() })

    canvas.dispatchEvent(pointerEvent('pointerdown', 100, 100))
    canvas.dispatchEvent(pointerEvent('pointerup', 101, 101))

    expect(onTap).toHaveBeenCalledWith(101, 101)
  })

  it('treats a drag as a pan, not a tap', () => {
    const canvas = document.createElement('canvas')
    canvas.setPointerCapture = vi.fn()
    canvas.releasePointerCapture = vi.fn()
    const onTap = vi.fn()
    const onPan = vi.fn()
    attachTouch(canvas, { onTap, onPan })

    canvas.dispatchEvent(pointerEvent('pointerdown', 100, 100))
    canvas.dispatchEvent(pointerEvent('pointermove', 160, 140))
    canvas.dispatchEvent(pointerEvent('pointerup', 160, 140))

    expect(onPan).toHaveBeenCalled()
    expect(onTap).not.toHaveBeenCalled()
  })

  it('detaches cleanly', () => {
    const canvas = document.createElement('canvas')
    canvas.setPointerCapture = vi.fn()
    canvas.releasePointerCapture = vi.fn()
    const onTap = vi.fn()
    const detach = attachTouch(canvas, { onTap, onPan: vi.fn() })
    detach()

    canvas.dispatchEvent(pointerEvent('pointerdown', 10, 10))
    canvas.dispatchEvent(pointerEvent('pointerup', 10, 10))

    expect(onTap).not.toHaveBeenCalled()
  })
})
