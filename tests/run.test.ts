import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { harvestAll } from '../harvest/run'
import { readExistingCell } from '../harvest/emit'
import type { GenreId, Song } from '../harvest/types'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'lta-run-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const countries = ['us', 'br'] as const
const genres = [{ id: 14, label: 'Pop' }, { id: 21, label: 'Rock' }] as const

function fakeSource(perCell = 10) {
  return {
    fetchCell: vi.fn(async (country: string, genre: GenreId): Promise<Song[]> =>
      Array.from({ length: perCell }, (_, i) => ({
        id: `${country}-${genre}-${i}`, title: `T${i}`, artist: `A${i}`,
        art: 'art', preview: 'prev', previewType: 'aac' as const,
        genre, country, source: 'itunes' as const, link: 'l', yt: 'y',
      })),
    ),
  }
}

describe('harvestAll', () => {
  it('visits every country x genre cell exactly once', async () => {
    const source = fakeSource()
    await harvestAll({ dir, countries, genres, source })
    expect(source.fetchCell).toHaveBeenCalledTimes(4)
  })

  it('writes one file per cell', async () => {
    await harvestAll({ dir, countries, genres, source: fakeSource() })
    for (const c of countries) {
      for (const g of genres) {
        expect(await readExistingCell(dir, `${c}-${g.id}`)).toHaveLength(10)
      }
    }
  })

  it('returns a manifest describing every cell', async () => {
    const m = await harvestAll({ dir, countries, genres, source: fakeSource() })
    expect(Object.keys(m.cells).sort()).toEqual(['br-14', 'br-21', 'us-14', 'us-21'])
    expect(m.cells['us-14']!.count).toBe(10)
  })

  it('omits a cell that yielded nothing, so the atlas can close the gap', async () => {
    const source = {
      fetchCell: async (c: string, g: GenreId): Promise<Song[]> =>
        c === 'br' && g === 21 ? [] : [{
          id: 'x', title: 'T', artist: 'A', art: 'a', preview: 'p',
          previewType: 'aac' as const, genre: g, country: c,
          source: 'itunes' as const, link: 'l', yt: 'y',
        }],
    }
    const m = await harvestAll({ dir, countries, genres, source })
    expect(m.cells['br-21']).toBeUndefined()
    expect(m.cells['us-14']).toBeDefined()
  })

  it('is resumable: a second run skips cells already on disk', async () => {
    const first = fakeSource()
    await harvestAll({ dir, countries, genres, source: first })

    const second = fakeSource()
    await harvestAll({ dir, countries, genres, source: second })
    expect(second.fetchCell).not.toHaveBeenCalled()
  })

  it('re-fetches everything when force is set', async () => {
    await harvestAll({ dir, countries, genres, source: fakeSource() })
    const forced = fakeSource()
    await harvestAll({ dir, countries, genres, source: forced, force: true })
    expect(forced.fetchCell).toHaveBeenCalledTimes(4)
  })

  it('keeps going when one cell throws', async () => {
    const source = {
      fetchCell: async (c: string, g: GenreId): Promise<Song[]> => {
        if (c === 'us' && g === 14) throw new Error('upstream exploded')
        return [{
          id: 'x', title: 'T', artist: 'A', art: 'a', preview: 'p',
          previewType: 'aac' as const, genre: g, country: c,
          source: 'itunes' as const, link: 'l', yt: 'y',
        }]
      },
    }
    const m = await harvestAll({ dir, countries, genres, source })
    expect(m.cells['us-14']).toBeUndefined()
    expect(Object.keys(m.cells)).toHaveLength(3)
  })

  it('reports progress', async () => {
    const seen: string[] = []
    await harvestAll({
      dir, countries, genres, source: fakeSource(),
      onProgress: (_d, _t, key) => seen.push(key),
    })
    expect(seen).toHaveLength(4)
  })
})
