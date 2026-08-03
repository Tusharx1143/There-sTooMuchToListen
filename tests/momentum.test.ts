import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Momentum } from '../src/render/momentum'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Momentum', () => {
  it('does not glide while still being pushed', () => {
    const apply = vi.fn()
    const m = new Momentum(apply)
    m.push(10, 0)
    expect(apply).not.toHaveBeenCalled()
  })

  it('glides after release and then stops', () => {
    const apply = vi.fn()
    const m = new Momentum(apply)
    m.push(20, 10)
    m.release()

    vi.advanceTimersByTime(32)
    expect(apply).toHaveBeenCalled()

    const callsAfterGlide = apply.mock.calls.length
    vi.advanceTimersByTime(3000)
    const callsAtRest = apply.mock.calls.length
    vi.advanceTimersByTime(3000)
    expect(apply.mock.calls.length).toBe(callsAtRest)
    expect(callsAtRest).toBeGreaterThan(callsAfterGlide - 1)
  })

  it('decays toward zero rather than accelerating', () => {
    const deltas: number[] = []
    const m = new Momentum((dx) => deltas.push(Math.abs(dx)))
    m.push(50, 0)
    m.release()
    vi.advanceTimersByTime(500)

    expect(deltas.length).toBeGreaterThan(1)
    expect(deltas[deltas.length - 1]!).toBeLessThan(deltas[0]!)
  })

  it('stop() halts an in-flight glide', () => {
    const apply = vi.fn()
    const m = new Momentum(apply)
    m.push(40, 0)
    m.release()
    vi.advanceTimersByTime(32)
    m.stop()

    const calls = apply.mock.calls.length
    vi.advanceTimersByTime(2000)
    expect(apply.mock.calls.length).toBe(calls)
  })

  it('a release with no push does nothing', () => {
    const apply = vi.fn()
    new Momentum(apply).release()
    vi.advanceTimersByTime(1000)
    expect(apply).not.toHaveBeenCalled()
  })
})
