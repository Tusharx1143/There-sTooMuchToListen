export type TouchHandlers = {
  onTap(x: number, y: number): void
  onPan(dx: number, dy: number): void
}

const TAP_THRESHOLD = 10

export function isTouchDevice(): boolean {
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches
}

export function attachTouch(canvas: HTMLCanvasElement, h: TouchHandlers): () => void {
  let down = false
  let moved = 0
  let lastX = 0
  let lastY = 0

  const onDown = (e: PointerEvent): void => {
    down = true
    moved = 0
    lastX = e.clientX
    lastY = e.clientY
    canvas.setPointerCapture(e.pointerId)
  }

  const onMove = (e: PointerEvent): void => {
    if (!down) return
    const dx = e.clientX - lastX
    const dy = e.clientY - lastY
    moved += Math.abs(dx) + Math.abs(dy)
    lastX = e.clientX
    lastY = e.clientY
    h.onPan(-dx, -dy)
  }

  const onUp = (e: PointerEvent): void => {
    if (down && moved < TAP_THRESHOLD) h.onTap(e.clientX, e.clientY)
    down = false
    canvas.releasePointerCapture(e.pointerId)
  }

  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)

  return () => {
    canvas.removeEventListener('pointerdown', onDown)
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerup', onUp)
  }
}
