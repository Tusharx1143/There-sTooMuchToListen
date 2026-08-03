import { describe, it, expect, vi } from 'vitest'
import { CellStore, loadManifest } from '../src/data/loader'
import { SCHEMA_VERSION } from '../src/types'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response
}

const manifest = {
  schemaVersion: SCHEMA_VERSION,
  harvestedAt: '2026-08-03T00:00:00.000Z',
  countries: ['us'],
  genres: [{ id: 14, label: 'Pop' }],
  cells: { 'us-14': { count: 2 } },
}

const twoSongs = [
  { id: 'a', title: 'A', artist: 'X', art: 'art', preview: 'p', previewType: 'aac', genre: 14, country: 'us', source: 'itunes', link: 'l', yt: 'y' },
  { id: 'b', title: 'B', artist: 'Y', art: 'art', preview: 'p', previewType: 'aac', genre: 14, country: 'us', source: 'itunes', link: 'l', yt: 'y' },
]

describe('loadManifest', () => {
  it('fetches manifest.json from the data base path', async () => {
    const fetcher = vi.fn(async () => jsonResponse(manifest)) as unknown as typeof fetch
    const m = await loadManifest(fetcher)
    expect(m.countries).toEqual(['us'])
    expect(fetcher).toHaveBeenCalledWith('/data/manifest.json')
  })

  it('refuses a manifest from a future schema', async () => {
    const bad = { ...manifest, schemaVersion: SCHEMA_VERSION + 1 }
    const fetcher = (async () => jsonResponse(bad)) as unknown as typeof fetch
    await expect(loadManifest(fetcher)).rejects.toThrow(/schema/i)
  })

  it('throws on a non-ok response', async () => {
    const fetcher = (async () => jsonResponse(null, false, 404)) as unknown as typeof fetch
    await expect(loadManifest(fetcher)).rejects.toThrow()
  })
})

describe('CellStore', () => {
  it('reports missing before anything is requested', () => {
    const store = new CellStore({ fetcher: (async () => jsonResponse([])) as unknown as typeof fetch })
    expect(store.status('us-14')).toBe('missing')
    expect(store.get('us-14')).toBeUndefined()
  })

  it('loads a requested cell and notifies subscribers', async () => {
    const fetcher = (async () => jsonResponse(twoSongs)) as unknown as typeof fetch
    const store = new CellStore({ fetcher })
    const onChange = vi.fn()
    store.onChange(onChange)

    store.ensure(['us-14'])
    expect(store.status('us-14')).toBe('loading')

    await vi.waitFor(() => expect(store.status('us-14')).toBe('ready'))
    expect(store.get('us-14')).toHaveLength(2)
    expect(onChange).toHaveBeenCalled()
  })

  it('requests each cell only once', async () => {
    const fetcher = vi.fn(async () => jsonResponse(twoSongs)) as unknown as typeof fetch
    const store = new CellStore({ fetcher })
    store.ensure(['us-14'])
    store.ensure(['us-14'])
    await vi.waitFor(() => expect(store.status('us-14')).toBe('ready'))
    store.ensure(['us-14'])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('retries once then marks the cell failed', async () => {
    const fetcher = vi.fn(async () => jsonResponse(null, false, 500)) as unknown as typeof fetch
    const store = new CellStore({ fetcher, retries: 1 })
    store.ensure(['us-14'])
    await vi.waitFor(() => expect(store.status('us-14')).toBe('failed'))
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('evicts cells that are no longer required', async () => {
    const fetcher = (async () => jsonResponse(twoSongs)) as unknown as typeof fetch
    const store = new CellStore({ fetcher })
    store.ensure(['us-14'])
    await vi.waitFor(() => expect(store.status('us-14')).toBe('ready'))

    store.ensure(['br-21'])
    expect(store.status('us-14')).toBe('missing')
  })

  it('stops notifying after unsubscribe', async () => {
    const fetcher = (async () => jsonResponse(twoSongs)) as unknown as typeof fetch
    const store = new CellStore({ fetcher })
    const onChange = vi.fn()
    const off = store.onChange(onChange)
    off()
    store.ensure(['us-14'])
    await vi.waitFor(() => expect(store.status('us-14')).toBe('ready'))
    expect(onChange).not.toHaveBeenCalled()
  })
})
