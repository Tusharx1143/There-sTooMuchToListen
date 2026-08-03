import { AtlasLayout } from './atlas/layout'
import { CellStore, loadManifest } from './data/loader'
import { ImageCache } from './render/imageCache'
import { AtlasRenderer, songAt } from './render/canvas'
import { AudioEngine } from './audio/engine'
import { showUnlockOverlay } from './audio/unlock'
import { attachPointer } from './input/pointer'
import { attachTouch, isTouchDevice } from './input/touch'
import { AxisHud } from './ui/axisLabels'
import { NowPlayingCard } from './ui/nowPlaying'
import { Minimap } from './ui/minimap'
import { SearchBox, buildTargets } from './ui/search'
import { showStaleNotice } from './ui/staleNotice'
import { VolumeControl } from './ui/volume'
import { Momentum } from './render/momentum'

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#atlas')
  const root = document.querySelector<HTMLElement>('#ui')
  if (!canvas || !root) throw new Error('missing #atlas or #ui')

  const manifest = await loadManifest()
  showStaleNotice(root, manifest.harvestedAt)
  const layout = new AtlasLayout(
    manifest.countries,
    manifest.genres.map((g) => g.id),
  )

  const store = new CellStore()
  const images = new ImageCache()
  const renderer = new AtlasRenderer(canvas, layout, store, images)
  const audio = new AudioEngine()

  const genreLabels = new Map(manifest.genres.map((g) => [g.id, g.label]))
  const hud = new AxisHud(root, layout, genreLabels)

  const card = new NowPlayingCard(root, () => {
    audio.unpin()
    card.hide()
  })

  const minimap = new Minimap(root, layout, (world) => {
    renderer.view = { x: 0, y: 0 }
    renderer.panBy(world.x - window.innerWidth / 2, world.y - window.innerHeight / 2)
    minimap.update({ ...renderer.view, w: window.innerWidth, h: window.innerHeight })
  })
  minimap.update({ ...renderer.view, w: window.innerWidth, h: window.innerHeight })

  new SearchBox(root, buildTargets(layout, genreLabels), (t) => {
    const centre =
      t.kind === 'country'
        ? layout.centreOf({ country: t.country!, genre: layout.genres[0]! })
        : layout.centreOf({ country: layout.countries[0]!, genre: t.genre! })
    if (!centre) return
    renderer.view = { x: 0, y: 0 }
    renderer.panBy(centre.x - window.innerWidth / 2, centre.y - window.innerHeight / 2)
    minimap.update({ ...renderer.view, w: window.innerWidth, h: window.innerHeight })
  })

  new VolumeControl(root, audio)

  renderer.failedSongs = audio.failed
  audio.onFailure(() => renderer.invalidate())

  renderer.start()
  window.addEventListener('resize', () => renderer.resize())

  const playAt = (x: number, y: number): void => {
    const hex = renderer.hoverAt(x, y)
    const song = hex ? songAt(hex, layout, store) : null
    renderer.setHover(hex)
    hud.update(hex)
    if (!song) return
    audio.pin(song)
    card.show(song)
  }

  const syncMinimap = (): void =>
    minimap.update({ ...renderer.view, w: window.innerWidth, h: window.innerHeight })

  const momentum = new Momentum((dx, dy) => {
    renderer.panBy(dx, dy)
    syncMinimap()
  })

  if (isTouchDevice()) {
    attachTouch(canvas, {
      onTap: playAt,
      onPan: (dx, dy) => {
        renderer.panBy(dx, dy)
        syncMinimap()
      },
    })
  } else {
    attachPointer(canvas, {
      onHover: (x, y) => {
        const hex = renderer.hoverAt(x, y)
        renderer.setHover(hex)
        hud.update(hex)
        audio.hover(hex ? songAt(hex, layout, store) : null)
      },
      onPan: (dx, dy) => {
        momentum.push(dx, dy)
        renderer.panBy(dx, dy)
        syncMinimap()
      },
      onClick: (x, y) => {
        const hex = renderer.hoverAt(x, y)
        const song = hex ? songAt(hex, layout, store) : null
        if (!song) return
        if (audio.pinned?.id === song.id) {
          audio.unpin()
          card.hide()
        } else {
          audio.pin(song)
          card.show(song)
        }
      },
      onLeave: () => {
        renderer.setHover(null)
        audio.hover(null)
      },
    })

    canvas.addEventListener('pointerup', () => momentum.release())
    canvas.addEventListener('pointerdown', () => momentum.stop())
  }

  showUnlockOverlay(root, () => {
    audio.setVolume(1)
  })
}

void boot().catch((err: unknown) => {
  document.body.innerHTML =
    `<p style="color:#c9c9de;font:16px system-ui;padding:2rem">` +
    `Could not start: ${(err as Error).message}</p>`
})
