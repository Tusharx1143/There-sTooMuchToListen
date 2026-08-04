/**
 * Shared shell for the overlay panels. Only one may be open at a time, so the
 * shells coordinate through a module-level registry rather than every caller
 * having to remember to close the others.
 */

const open = new Set<Panel>()

export class Panel {
  readonly el: HTMLElement
  private readonly onToggle = new Set<(open: boolean) => void>()

  constructor(root: HTMLElement, name: string) {
    this.el = document.createElement('section')
    this.el.className = 'panel'
    this.el.setAttribute('data-panel', name)
    this.el.setAttribute('role', 'dialog')
    this.el.setAttribute('aria-label', name)
    this.el.hidden = true
    root.appendChild(this.el)
  }

  get isOpen(): boolean {
    return open.has(this)
  }

  onChange(cb: (open: boolean) => void): () => void {
    this.onToggle.add(cb)
    return () => this.onToggle.delete(cb)
  }

  show(): void {
    if (this.isOpen) return
    for (const other of [...open]) other.hide()

    this.el.hidden = false
    // The element must be laid out un-opened for one frame or the transition
    // has no start value to animate from and the panel simply appears.
    void this.el.offsetHeight
    this.el.setAttribute('data-open', '')
    open.add(this)
    this.emit(true)
  }

  hide(): void {
    if (!this.isOpen) return
    open.delete(this)
    this.el.removeAttribute('data-open')
    this.emit(false)

    // Stay in the tree until the fade finishes, then drop out of the
    // accessibility tree entirely.
    const done = (): void => {
      if (!this.isOpen) this.el.hidden = true
    }
    if (typeof this.el.addEventListener === 'function') {
      this.el.addEventListener('transitionend', done, { once: true })
    }
    setTimeout(done, 400) // transitionend never fires under reduced motion
  }

  toggle(): void {
    if (this.isOpen) this.hide()
    else this.show()
  }

  private emit(state: boolean): void {
    for (const cb of this.onToggle) cb(state)
  }
}

/** Closes whatever is open. Wired to Escape and to clicks on the atlas. */
export function closeAllPanels(): void {
  for (const p of [...open]) p.hide()
}

export function anyPanelOpen(): boolean {
  return open.size > 0
}
