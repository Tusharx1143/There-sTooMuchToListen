import { describe, it, expect } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (e) => {
      const p = join(dir, e.name)
      return e.isDirectory() ? walk(p) : [p]
    }),
  )
  return files.flat().filter((f) => f.endsWith('.ts'))
}

const FORBIDDEN = [
  'itunes.apple.com',
  'rss.applemarketingtools.com',
  'api.deezer.com',
  'api.jamendo.com',
  'googleapis.com',
]

describe('browser bundle isolation', () => {
  it('never references a music API host', async () => {
    for (const file of await walk('src')) {
      const text = await readFile(file, 'utf8')
      for (const host of FORBIDDEN) {
        expect(text, `${file} must not call ${host} — harvest owns that`).not.toContain(host)
      }
    }
  })

  it('never imports Node built-ins', async () => {
    for (const file of await walk('src')) {
      const text = await readFile(file, 'utf8')
      expect(text, `${file} imports a Node module`).not.toMatch(/from\s+['"]node:/)
    }
  })

  it('only imports pure modules from harvest/', async () => {
    const allowed = /from\s+['"]\.\.?\/(\.\.\/)?harvest\/(types|taxonomy)['"]/
    for (const file of await walk('src')) {
      const text = await readFile(file, 'utf8')
      const harvestImports = text.match(/from\s+['"][^'"]*harvest\/[^'"]+['"]/g) ?? []
      for (const imp of harvestImports) {
        expect(imp, `${file}: only harvest/types and harvest/taxonomy may be imported`)
          .toMatch(allowed)
      }
    }
  })
})
