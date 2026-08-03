export const STALE_AFTER_DAYS = 30

export function isStale(harvestedAt: string, now: Date = new Date()): boolean {
  const then = Date.parse(harvestedAt)
  if (Number.isNaN(then)) return true
  const ageDays = (now.getTime() - then) / 86_400_000
  return ageDays > STALE_AFTER_DAYS
}

export function showStaleNotice(root: HTMLElement, harvestedAt: string): void {
  if (!isStale(harvestedAt)) return

  const el = document.createElement('p')
  el.setAttribute('data-stale', '')
  el.className = 'stale-notice'
  el.textContent = `Catalogue last refreshed ${new Date(harvestedAt).toLocaleDateString()}`
  root.appendChild(el)
}
