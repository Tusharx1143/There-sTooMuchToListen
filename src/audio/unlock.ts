/**
 * Browsers block audio until a user gesture. One click anywhere unlocks
 * playback for the whole session.
 */
export function showUnlockOverlay(root: HTMLElement, onUnlock: () => void): void {
  const el = document.createElement('div')
  el.setAttribute('data-unlock', '')
  el.innerHTML = `
    <div class="unlock-inner">
      <h1>Listen to Anything</h1>
      <p>Every tile is a song. Move your cursor and let it rest.</p>
      <p class="unlock-cta">Click anywhere to start</p>
    </div>
  `

  let fired = false
  el.addEventListener('click', () => {
    if (fired) return
    fired = true
    el.remove()
    onUnlock()
  })

  root.appendChild(el)
}
