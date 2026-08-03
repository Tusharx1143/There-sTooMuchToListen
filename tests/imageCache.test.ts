import { describe, it, expect, vi } from 'vitest'
import { ImageCache, fallbackColors } from '../src/render/imageCache'

/** A stand-in for HTMLImageElement that we can resolve on demand. */
function fakeImageFactory() {
  const created: any[] = []
  const make = () => {
    const img: any = { src: '', complete: false, naturalWidth: 0 }
    img.decode = vi.fn(async () => { img.complete = true; img.naturalWidth = 600 })
    created.push(img)
    return img as HTMLImageElement
  }
  return { make, created }
}

describe('ImageCache', () => {
  it('returns null on first request and starts a load', () => {
    const { make, created } = fakeImageFactory()
    const cache = new ImageCache({ make })
    expect(cache.get('https://x/a.jpg')).toBeNull()
    expect(created).toHaveLength(1)
    expect(created[0].src).toBe('https://x/a.jpg')
  })

  it('returns the image once decoded, and notifies', async () => {
    const { make } = fakeImageFactory()
    const cache = new ImageCache({ make })
    const onLoad = vi.fn()
    cache.onLoad(onLoad)

    cache.get('https://x/a.jpg')
    await vi.waitFor(() => expect(cache.get('https://x/a.jpg')).not.toBeNull())
    expect(onLoad).toHaveBeenCalled()
  })

  it('only creates one element per URL', () => {
    const { make, created } = fakeImageFactory()
    const cache = new ImageCache({ make })
    cache.get('https://x/a.jpg')
    cache.get('https://x/a.jpg')
    expect(created).toHaveLength(1)
  })

  it('evicts least-recently-used entries past capacity', async () => {
    const { make } = fakeImageFactory()
    const cache = new ImageCache({ capacity: 2, make })
    cache.get('a'); cache.get('b')
    await vi.waitFor(() => expect(cache.get('a')).not.toBeNull())

    cache.get('a')      // touch 'a' so 'b' becomes least-recent
    cache.get('c')      // pushes past capacity
    expect(cache.size).toBe(2)
  })

  it('marks a failed image as failed rather than retrying forever', async () => {
    const make = () => {
      const img: any = { src: '', complete: false }
      img.decode = vi.fn(async () => { throw new Error('404') })
      return img as HTMLImageElement
    }
    const cache = new ImageCache({ make })
    cache.get('bad')
    await vi.waitFor(() => expect(cache.size).toBe(1))
    expect(cache.get('bad')).toBeNull()
  })
})

describe('fallbackColors', () => {
  it('is deterministic for the same id', () => {
    expect(fallbackColors('abc')).toEqual(fallbackColors('abc'))
  })

  it('differs between ids', () => {
    expect(fallbackColors('abc')).not.toEqual(fallbackColors('xyz'))
  })

  it('returns two CSS hsl colours', () => {
    const [a, b] = fallbackColors('abc')
    expect(a).toMatch(/^hsl\(/)
    expect(b).toMatch(/^hsl\(/)
  })
})
