import { describe, it, expect, vi } from 'vitest'
import { AtlasLayout } from '../src/atlas/layout'
import { CellStore } from '../src/data/loader'
import { songAt } from '../src/render/canvas'
import type { Song } from '../src/types'

const layout = new AtlasLayout(['us', 'br'], [14, 21])

function storeWith(key: string, songs: Song[]): CellStore {
  const fetcher = (async () => ({ ok: true, status: 200, json: async () => songs })) as unknown as typeof fetch
  const store = new CellStore({ fetcher })
  store.ensure([key])
  return store
}

function songs(n: number): Song[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `id${i}`, title: `T${i}`, artist: `A${i}`, art: 'art', preview: 'p',
    previewType: 'aac' as const, genre: 14, country: 'us',
    source: 'itunes' as const, link: 'l', yt: 'y',
  }))
}

describe('songAt', () => {
  it('returns null while the cell is still loading', () => {
    const store = storeWith('us-14', songs(50))
    expect(songAt({ col: 0, row: 0 }, layout, store)).toBeNull()
  })

  it('returns the song once the cell is ready', async () => {
    const store = storeWith('us-14', songs(50))
    await vi.waitFor(() => expect(store.status('us-14')).toBe('ready'))
    expect(songAt({ col: 0, row: 0 }, layout, store)?.title).toBe('T0')
    expect(songAt({ col: 1, row: 0 }, layout, store)?.title).toBe('T1')
  })

  it('returns null outside the atlas', async () => {
    const store = storeWith('us-14', songs(50))
    await vi.waitFor(() => expect(store.status('us-14')).toBe('ready'))
    expect(songAt({ col: -1, row: 0 }, layout, store)).toBeNull()
    expect(songAt({ col: 999, row: 0 }, layout, store)).toBeNull()
  })

  it('returns null when the cell is short of that index', async () => {
    const store = storeWith('us-14', songs(3))
    await vi.waitFor(() => expect(store.status('us-14')).toBe('ready'))
    expect(songAt({ col: 0, row: 0 }, layout, store)).not.toBeNull()
    expect(songAt({ col: 4, row: 9 }, layout, store)).toBeNull()
  })
})
