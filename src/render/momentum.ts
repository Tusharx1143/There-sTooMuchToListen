const FRAME_MS = 16
const DECAY = 0.92
const MIN_VELOCITY = 0.4

/** Carries a drag's final velocity forward with exponential decay. */
export class Momentum {
  private vx = 0
  private vy = 0
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly apply: (dx: number, dy: number) => void) {}

  /** Called on every drag move; records velocity but does not glide yet. */
  push(dx: number, dy: number): void {
    this.stop()
    this.vx = dx
    this.vy = dy
  }

  release(): void {
    if (Math.abs(this.vx) < MIN_VELOCITY && Math.abs(this.vy) < MIN_VELOCITY) return

    this.timer = setInterval(() => {
      this.vx *= DECAY
      this.vy *= DECAY

      if (Math.abs(this.vx) < MIN_VELOCITY && Math.abs(this.vy) < MIN_VELOCITY) {
        this.stop()
        return
      }
      this.apply(this.vx, this.vy)
    }, FRAME_MS)
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }
}
