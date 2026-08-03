export type PointerHandlers = {
  onHover(x: number, y: number): void
  onPan(dx: number, dy: number): void
  onClick(x: number, y: number): void
  onLeave(): void
}

/** A drag longer than this many pixels suppresses the click. */
const DRAG_THRESHOLD = 4

export function attachPointer(canvas: HTMLCanvasElement, h: PointerHandlers): () => void {
  let dragging = false
  let moved = 0
  let lastX = 0
  let lastY = 0

  const onDown = (e: PointerEvent): void => {
    dragging = true
    moved = 0
    lastX = e.clientX
    lastY = e.clientY
    canvas.setPointerCapture(e.pointerId)
  }

  const onMove = (e: PointerEvent): void => {
    if (dragging) {
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      moved += Math.abs(dx) + Math.abs(dy)
      lastX = e.clientX
      lastY = e.clientY
      // Dragging right should reveal what is to the left, so invert.
      h.onPan(-dx, -dy)
    }
    h.onHover(e.clientX, e.clientY)
  }

  const onUp = (e: PointerEvent): void => {
    if (dragging && moved < DRAG_THRESHOLD) h.onClick(e.clientX, e.clientY)
    dragging = false
    canvas.releasePointerCapture(e.pointerId)
  }

  const onLeave = (): void => {
    dragging = false
    h.onLeave()
  }

  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointerleave', onLeave)

  return () => {
    canvas.removeEventListener('pointerdown', onDown)
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerup', onUp)
    canvas.removeEventListener('pointerleave', onLeave)
  }
}
