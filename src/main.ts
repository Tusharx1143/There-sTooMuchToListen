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
import { SettingsStore } from './state/settings'
import { ThemeController } from './state/theme'
import { Toolbar } from './ui/toolbar'
import { AboutPanel } from './ui/aboutPanel'
import { SettingsPanel } from './ui/settingsPanel'
import { closeAllPanels } from './ui/panel'
import { HoverLabel } from './ui/hoverLabel'
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

  const settings = new SettingsStore()
  const theme = new ThemeController(settings)

  const store = new CellStore()
  const images = new ImageCache()
  const renderer = new AtlasRenderer(
    canvas,
    layout,
    store,
    images,
    () => document.createElement('canvas'),
    settings,
  )
  const audio = new AudioEngine()

  renderer.setPalette(theme.palette)

  const genreLabels = new Map(manifest.genres.map((g) => [g.id, g.label]))
  const hud = new AxisHud(root, layout, genreLabels)

  // Hoisted so the card's close button can reach it; both only ever run in
  // response to a click, long after `label` below is initialised.
  function setPinned(songId: string | null): void {
    renderer.pinned = songId !== null
    label.setPinned(songId)
  }

  const card = new NowPlayingCard(root, () => {
    audio.unpin()
    card.hide()
    setPinned(null)
  })

  const minimap = new Minimap(root, layout, (world) => {
    renderer.view = { x: 0, y: 0 }
    renderer.panBy(world.x - window.innerWidth / 2, world.y - window.innerHeight / 2)
    minimap.update({ ...renderer.view, w: window.innerWidth, h: window.innerHeight })
  })
  minimap.setPalette(theme.palette)
  minimap.update({ ...renderer.view, w: window.innerWidth, h: window.innerHeight })

  // Both canvases carry their own colours, so the theme has to reach each.
  theme.onChange(() => {
    renderer.setPalette(theme.palette)
    minimap.setPalette(theme.palette)
  })

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

  const about = new AboutPanel(root, manifest.harvestedAt)
  const settingsPanel = new SettingsPanel(root, settings, audio)

  const toolbar = new Toolbar(root, settings, theme, {
    onAbout: () => about.panel.toggle(),
    onSettings: () => settingsPanel.panel.toggle(),
  })
  about.panel.onChange((open) => toolbar.setExpanded('about', open))
  settingsPanel.panel.onChange((open) => toolbar.setExpanded('settings', open))

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllPanels()
  })

  renderer.failedSongs = audio.failed
  audio.onFailure(() => renderer.invalidateField())

  // Audio waits for the lens to park — starting a preview per tile crossed
  // would be unlistenable.
  renderer.onFocalChange((hex) => {
    audio.hover(hex ? songAt(hex, layout, store) : null)
  })

  // The readouts track the lens as it travels instead. The label fades itself
  // out while moving, so it names the tile without strobing through hundreds.
  const label = new HoverLabel(root)
  renderer.onHoverChange((hex) => {
    hud.update(hex)
    label.show(hex ? songAt(hex, layout, store) : null)
  })
  renderer.onFrame(() =>
    label.update(renderer.lensCentre, renderer.speedScale, {
      w: window.innerWidth,
      h: window.innerHeight,
    }),
  )

  renderer.start()
  window.addEventListener('resize', () => renderer.resize())

  // Reaching back into the atlas dismisses whatever is open, the same way
  // clicking outside a dialog would.
  canvas.addEventListener('pointerdown', () => closeAllPanels())

  const playAt = (x: number, y: number): void => {
    const hex = renderer.hoverAt(x, y)
    const song = hex ? songAt(hex, layout, store) : null
    hud.update(hex)
    if (!song) return
    audio.pin(song)
    card.show(song)
    setPinned(song.id)
  }

  const syncMinimap = (): void =>
    minimap.update({ ...renderer.view, w: window.innerWidth, h: window.innerHeight })

  // Tile size rewrites every world coordinate, so the minimap's viewport
  // rectangle is stale until it is told.
  settings.onChange((_s, changed) => {
    if (changed === 'tileSize') syncMinimap()
  })

  const momentum = new Momentum((dx, dy) => {
    renderer.panBy(dx, dy)
    syncMinimap()
  })

  if (isTouchDevice()) {
    // No cursor to follow: park the lens mid-screen and let panning move the
    // world beneath it.
    const pinLens = (): void => {
      renderer.lensTarget = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    }
    pinLens()
    window.addEventListener('resize', pinLens)

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
        renderer.lensTarget = { x, y }
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
          setPinned(null)
        } else {
          audio.pin(song)
          card.show(song)
          setPinned(song.id)
        }
      },
      onLeave: () => {
        // Leave the lens parked where it is rather than snapping it away.
        audio.hover(null)
      },
    })

    canvas.addEventListener('pointerup', () => momentum.release())
    canvas.addEventListener('pointerdown', () => momentum.stop())
  }

  showUnlockOverlay(root, () => {})
}

void boot().catch((err: unknown) => {
  document.body.innerHTML =
    `<p style="color:#c9c9de;font:16px system-ui;padding:2rem">` +
    `Could not start: ${(err as Error).message}</p>`
})
