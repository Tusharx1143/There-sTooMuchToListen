import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeCell, buildManifest, writeManifest, readExistingCell, THIN_THRESHOLD } from '../harvest/emit'
import { SCHEMA_VERSION } from '../harvest/types'
import type { Song } from '../harvest/types'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'lta-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

function songs(n: number): Song[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `id${i}`, title: `T${i}`, artist: `A${i}`, art: 'art', preview: 'prev',
    previewType: 'aac' as const, genre: 14, country: 'us',
    source: 'itunes' as const, link: 'l', yt: 'y',
  }))
}

describe('writeCell', () => {
  it('writes a JSON array and reports the count', async () => {
    const stats = await writeCell(dir, 'us-14', songs(50))
    expect(stats).toEqual({ count: 50 })
    const parsed = JSON.parse(await readFile(join(dir, 'cells', 'us-14.json'), 'utf8'))
    expect(parsed).toHaveLength(50)
    expect(parsed[0].title).toBe('T0')
  })

  it('truncates to at most SONGS_PER_CELL', async () => {
    const stats = await writeCell(dir, 'us-14', songs(80))
    expect(stats.count).toBe(50)
  })

  it('flags a thin cell', async () => {
    const stats = await writeCell(dir, 'us-14', songs(THIN_THRESHOLD - 1))
    expect(stats.thin).toBe(true)
  })

  it('does not flag a healthy cell', async () => {
    const stats = await writeCell(dir, 'us-14', songs(THIN_THRESHOLD))
    expect(stats.thin).toBeUndefined()
  })
})

describe('readExistingCell', () => {
  it('reads back what writeCell wrote', async () => {
    await writeCell(dir, 'us-14', songs(3))
    const back = await readExistingCell(dir, 'us-14')
    expect(back).toHaveLength(3)
  })

  it('returns null for a cell that was never written', async () => {
    expect(await readExistingCell(dir, 'zz-99')).toBeNull()
  })
})

describe('buildManifest', () => {
  it('stamps schema version and an ISO timestamp', () => {
    const m = buildManifest({ 'us-14': { count: 50 } }, ['us'], [{ id: 14, label: 'Pop' }])
    expect(m.schemaVersion).toBe(SCHEMA_VERSION)
    expect(() => new Date(m.harvestedAt).toISOString()).not.toThrow()
  })

  it('carries the axis order through unchanged', () => {
    const m = buildManifest({}, ['us', 'br'], [{ id: 14, label: 'Pop' }, { id: 21, label: 'Rock' }])
    expect(m.countries).toEqual(['us', 'br'])
    expect(m.genres.map((g) => g.id)).toEqual([14, 21])
  })
})

describe('writeManifest', () => {
  it('writes manifest.json at the root of the data dir', async () => {
    const m = buildManifest({ 'us-14': { count: 50 } }, ['us'], [{ id: 14, label: 'Pop' }])
    await writeManifest(dir, m)
    const parsed = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))
    expect(parsed.cells['us-14'].count).toBe(50)
  })
})
