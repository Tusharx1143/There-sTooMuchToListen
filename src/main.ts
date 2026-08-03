import { AtlasLayout } from './atlas/layout'
import { CellStore, loadManifest } from './data/loader'
import { ImageCache } from './render/imageCache'
import { AtlasRenderer, songAt } from './render/canvas'
import { AudioEngine } from './audio/engine'
import { showUnlockOverlay } from './audio/unlock'
import { attachPointer } from './input/pointer'

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#atlas')
  const root = document.querySelector<HTMLElement>('#ui')
  if (!canvas || !root) throw new Error('missing #atlas or #ui')

  const manifest = await loadManifest()
  const layout = new AtlasLayout(
    manifest.countries,
    manifest.genres.map((g) => g.id),
  )

  const store = new CellStore()
  const images = new ImageCache()
  const renderer = new AtlasRenderer(canvas, layout, store, images)
  const audio = new AudioEngine()

  renderer.start()
  window.addEventListener('resize', () => renderer.resize())

  attachPointer(canvas, {
    onHover: (x, y) => {
      const hex = renderer.hoverAt(x, y)
      renderer.setHover(hex)
      audio.hover(hex ? songAt(hex, layout, store) : null)
    },
    onPan: (dx, dy) => renderer.panBy(dx, dy),
    onClick: (x, y) => {
      const hex = renderer.hoverAt(x, y)
      const song = hex ? songAt(hex, layout, store) : null
      if (!song) return
      if (audio.pinned?.id === song.id) audio.unpin()
      else audio.pin(song)
    },
    onLeave: () => {
      renderer.setHover(null)
      audio.hover(null)
    },
  })

  showUnlockOverlay(root, () => {
    audio.setVolume(1)
  })
}

void boot().catch((err: unknown) => {
  document.body.innerHTML =
    `<p style="color:#c9c9de;font:16px system-ui;padding:2rem">` +
    `Could not start: ${(err as Error).message}</p>`
})
