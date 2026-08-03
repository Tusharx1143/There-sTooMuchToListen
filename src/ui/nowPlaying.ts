import type { Song } from '../types'

export class NowPlayingCard {
  private readonly el: HTMLElement

  constructor(root: HTMLElement, private readonly onClose: () => void) {
    this.el = document.createElement('aside')
    this.el.setAttribute('data-now-playing', '')
    this.el.className = 'now-playing'
    root.appendChild(this.el)
  }

  show(song: Song): void {
    this.el.replaceChildren()

    const art = document.createElement('img')
    art.src = song.art
    art.alt = ''
    art.className = 'np-art'

    const body = document.createElement('div')
    body.className = 'np-body'

    const title = document.createElement('h2')
    title.textContent = song.title            // text node: no markup injection

    const artist = document.createElement('p')
    artist.className = 'np-artist'
    artist.textContent = song.artist

    body.append(title, artist)

    if (song.album) {
      const album = document.createElement('p')
      album.className = 'np-album'
      album.textContent = song.album
      body.appendChild(album)
    }

    const links = document.createElement('div')
    links.className = 'np-links'
    links.append(
      this.link(song.yt, 'Full song on YouTube'),
      this.link(song.link, 'Store page'),
    )
    body.appendChild(links)

    const close = document.createElement('button')
    close.setAttribute('data-close', '')
    close.className = 'np-close'
    close.textContent = '×'
    close.setAttribute('aria-label', 'Unpin song')
    close.addEventListener('click', () => this.onClose())

    this.el.append(body, close)
    this.el.classList.add('visible')
  }

  hide(): void {
    this.el.classList.remove('visible')
    this.el.replaceChildren()
  }

  private link(href: string, text: string): HTMLAnchorElement {
    const a = document.createElement('a')
    a.href = href
    a.textContent = text
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    return a
  }
}
