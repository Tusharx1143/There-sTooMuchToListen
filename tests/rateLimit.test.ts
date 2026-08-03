import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TokenBucket } from '../harvest/rateLimit'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('TokenBucket', () => {
  it('allows the burst immediately', async () => {
    const bucket = new TokenBucket(5, 3)
    const done: number[] = []
    for (let i = 0; i < 3; i++) void bucket.take().then(() => done.push(i))
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toEqual([0, 1, 2])
  })

  it('delays the request that exceeds the burst', async () => {
    const bucket = new TokenBucket(5, 1) // 1 token, refills at 5/sec = 200ms each
    const done: number[] = []
    void bucket.take().then(() => done.push(0))
    void bucket.take().then(() => done.push(1))

    await vi.advanceTimersByTimeAsync(0)
    expect(done).toEqual([0])

    await vi.advanceTimersByTimeAsync(200)
    expect(done).toEqual([0, 1])
  })

  it('serialises a queue in order', async () => {
    const bucket = new TokenBucket(10, 1) // 100ms per token
    const done: number[] = []
    for (let i = 0; i < 4; i++) void bucket.take().then(() => done.push(i))
    await vi.advanceTimersByTimeAsync(1000)
    expect(done).toEqual([0, 1, 2, 3])
  })
})
