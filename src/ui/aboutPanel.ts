import { Panel } from './panel'

const CHEVRON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round" stroke-linejoin="round" class="acc-chevron" aria-hidden="true">' +
  '<path d="m6 9 6 6 6-6"/></svg>'

type Section = { title: string; body: () => HTMLElement; open?: boolean }

function paragraphs(...texts: string[]): HTMLElement {
  const wrap = document.createElement('div')
  for (const t of texts) {
    const p = document.createElement('p')
    p.textContent = t
    wrap.appendChild(p)
  }
  return wrap
}

/**
 * One accordion item. The height animation needs a concrete pixel value —
 * `auto` is not an animatable length — so the open height is measured from the
 * content on every toggle rather than cached, which keeps it correct when the
 * panel is resized or its text reflows.
 */
function accordionItem(section: Section): HTMLElement {
  const item = document.createElement('div')
  item.className = 'acc-item'

  const trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.className = 'acc-trigger'
  trigger.setAttribute('aria-expanded', String(section.open === true))

  const title = document.createElement('h2')
  title.textContent = section.title
  trigger.append(title)
  trigger.insertAdjacentHTML('beforeend', CHEVRON)

  const region = document.createElement('div')
  region.className = 'acc-panel'

  const body = document.createElement('div')
  body.className = 'acc-body'
  body.appendChild(section.body())
  region.appendChild(body)

  const setOpen = (open: boolean, animate: boolean): void => {
    trigger.setAttribute('aria-expanded', String(open))

    // The initial state is set while the panel is still `hidden`, where every
    // measurement is 0. `auto` is the only correct answer until it is on screen.
    if (!animate) {
      region.style.height = open ? 'auto' : '0px'
      return
    }

    if (open) {
      region.style.height = `${body.offsetHeight}px`
      return
    }

    // Collapsing from `auto` has no start value to animate from, so pin the
    // measured height, force a reflow, then go to zero.
    region.style.height = `${body.offsetHeight}px`
    void region.offsetHeight
    region.style.height = '0px'
  }

  trigger.addEventListener('click', () => {
    setOpen(trigger.getAttribute('aria-expanded') !== 'true', true)
  })

  // Settle to a fixed height once open, so long text can still reflow freely.
  region.addEventListener('transitionend', (e) => {
    if (e.propertyName !== 'height') return
    if (trigger.getAttribute('aria-expanded') === 'true') region.style.height = 'auto'
  })

  item.append(trigger, region)
  queueMicrotask(() => setOpen(section.open === true, false))
  return item
}

export class AboutPanel {
  readonly panel: Panel

  constructor(root: HTMLElement, harvestedAt?: string) {
    this.panel = new Panel(root, 'About')

    const sections: Section[] = [
      {
        title: 'About',
        open: true,
        body: () =>
          paragraphs(
            'Every hexagon is a song. Move the cursor and let it rest, and the ' +
              'track under the lens starts playing.',
            'The atlas is laid out by country across and genre down, so drifting ' +
              'sideways changes where you are in the world and drifting down ' +
              'changes what you are listening to.',
          ),
      },
      {
        title: 'Controls',
        body: () => {
          const rows: [string, string][] = [
            ['Move the cursor', 'Preview whatever it settles on'],
            ['Click a tile', 'Pin that song; click again to unpin'],
            ['Drag', 'Pan the atlas'],
            ['Search, top left', 'Jump to a country or genre'],
            ['Minimap, bottom right', 'Click to jump anywhere'],
          ]
          const dl = document.createElement('div')
          for (const [key, what] of rows) {
            const p = document.createElement('p')
            const b = document.createElement('strong')
            b.textContent = key
            p.append(b, document.createTextNode(` — ${what}`))
            dl.appendChild(p)
          }
          return dl
        },
      },
      {
        title: 'Data & credits',
        // No source link here on purpose: the toolbar carries its own GitHub
        // button, and one route to the repository is enough.
        body: () => {
          const wrap = paragraphs(
            'Previews, cover art and metadata are harvested from the iTunes ' +
              'Search API, Deezer and Jamendo. Each tile links back to the store ' +
              'page it came from.',
          )
          if (harvestedAt) {
            const p = document.createElement('p')
            p.textContent = `Catalogue harvested ${new Date(harvestedAt).toLocaleDateString()}.`
            wrap.appendChild(p)
          }
          return wrap
        },
      },
    ]

    for (const s of sections) this.panel.el.appendChild(accordionItem(s))

    const actions = document.createElement('div')
    actions.className = 'panel-actions'
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'btn'
    close.textContent = 'Close'
    close.addEventListener('click', () => this.panel.hide())
    actions.appendChild(close)
    this.panel.el.appendChild(actions)
  }
}
