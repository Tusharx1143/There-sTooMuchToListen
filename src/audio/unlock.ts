/** How long the overlay takes to clear, matching the reference's intro fade. */
export const INTRO_FADE_MS = 700

/**
 * The opening screen. It also serves a hard requirement: browsers block audio
 * until a user gesture, and this is that gesture.
 *
 * `onUnlock` fires immediately on the click, so the atlas can start its own
 * reveal underneath while the overlay is still fading out.
 */
export function showUnlockOverlay(root: HTMLElement, onUnlock: () => void): void {
  const el = document.createElement('div')
  el.setAttribute('data-unlock', '')

  const inner = document.createElement('div')
  inner.className = 'unlock-inner'

  const h1 = document.createElement('h1')
  h1.className = 'unlock-title'
  // The ellipsis is a pseudo-element cycling '' → . → .. → ... so the line
  // never reflows as it animates.
  h1.innerHTML = '<i>&ldquo;There&rsquo;s too much to listen to&rdquo;</i><span class="unlock-ellipsis"></span>'

  const cta = document.createElement('button')
  cta.type = 'button'
  cta.className = 'unlock-cta'
  cta.setAttribute('data-unlock-start', '')
  cta.textContent = 'Start listening'

  inner.append(h1, cta)
  el.appendChild(inner)

  let fired = false
  const start = (): void => {
    if (fired) return
    fired = true
    el.setAttribute('data-leaving', '')
    onUnlock()

    const done = (): void => el.remove()
    el.addEventListener('transitionend', done, { once: true })
    // transitionend never arrives under prefers-reduced-motion.
    setTimeout(done, INTRO_FADE_MS + 120)
  }

  el.addEventListener('click', start)
  root.appendChild(el)
}
