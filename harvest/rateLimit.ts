/**
 * Simple token bucket. One instance per upstream source keeps us politely
 * under rate limits without needing to think about concurrency at call sites.
 */
export class TokenBucket {
  private tokens: number
  private last: number
  private queue: Array<() => void> = []
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly ratePerSec: number,
    private readonly burst: number,
  ) {
    this.tokens = burst
    this.last = Date.now()
  }

  take(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.queue.push(resolve)
      this.pump()
    })
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = (now - this.last) / 1000
    this.last = now
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.ratePerSec)
  }

  private pump(): void {
    this.refill()

    while (this.tokens >= 1 && this.queue.length > 0) {
      this.tokens -= 1
      const resolve = this.queue.shift()!
      resolve()
    }

    if (this.queue.length > 0 && this.timer === null) {
      const waitMs = Math.ceil(((1 - this.tokens) / this.ratePerSec) * 1000)
      this.timer = setTimeout(() => {
        this.timer = null
        this.pump()
      }, Math.max(waitMs, 1))
    }
  }
}
