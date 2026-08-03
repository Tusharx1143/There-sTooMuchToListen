import { SCHEMA_VERSION, type Manifest, type Song } from '../types'

const DEFAULT_BASE = '/data'

export async function loadManifest(
  fetcher: typeof fetch = fetch,
  base: string = DEFAULT_BASE,
): Promise<Manifest> {
  const res = await fetcher(`${base}/manifest.json`)
  if (!res.ok) throw new Error(`manifest fetch failed: ${res.status}`)

  const manifest = (await res.json()) as Manifest
  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `manifest schema ${manifest.schemaVersion} does not match app schema ${SCHEMA_VERSION} — re-run the harvest`,
    )
  }
  return manifest
}

type CellState =
  | { status: 'loading' }
  | { status: 'ready'; songs: Song[] }
  | { status: 'failed' }

export class CellStore {
  private readonly cells = new Map<string, CellState>()
  private readonly listeners = new Set<() => void>()
  private readonly fetcher: typeof fetch
  private readonly base: string
  private readonly retries: number

  constructor(opts: { fetcher?: typeof fetch; base?: string; retries?: number } = {}) {
    this.fetcher = opts.fetcher ?? fetch
    this.base = opts.base ?? DEFAULT_BASE
    this.retries = opts.retries ?? 1
  }

  get(key: string): Song[] | undefined {
    const state = this.cells.get(key)
    return state?.status === 'ready' ? state.songs : undefined
  }

  status(key: string): 'missing' | 'loading' | 'ready' | 'failed' {
    return this.cells.get(key)?.status ?? 'missing'
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** Load anything in `keys` that is not loaded; drop anything not in `keys`. */
  ensure(keys: string[]): void {
    const wanted = new Set(keys)

    for (const key of [...this.cells.keys()]) {
      if (!wanted.has(key)) this.cells.delete(key)
    }

    for (const key of wanted) {
      if (this.cells.has(key)) continue
      this.cells.set(key, { status: 'loading' })
      void this.load(key)
    }
  }

  private async load(key: string): Promise<void> {
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await this.fetcher(`${this.base}/cells/${key}.json`)
        if (!res.ok) throw new Error(String(res.status))
        const songs = (await res.json()) as Song[]

        // The cell may have been evicted while in flight.
        if (!this.cells.has(key)) return
        this.cells.set(key, { status: 'ready', songs })
        this.emit()
        return
      } catch {
        if (attempt === this.retries) {
          if (!this.cells.has(key)) return
          this.cells.set(key, { status: 'failed' })
          this.emit()
        }
      }
    }
  }

  private emit(): void {
    for (const cb of this.listeners) cb()
  }
}
