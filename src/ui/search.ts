import type { AtlasLayout } from '../atlas/layout'
import type { GenreId } from '../types'
import { countryName } from './axisLabels'

export type JumpTarget = {
  kind: 'country' | 'genre'
  label: string
  country?: string
  genre?: GenreId
}

const MAX_RESULTS = 8

export function buildTargets(
  layout: AtlasLayout,
  genreLabels: Map<GenreId, string>,
): JumpTarget[] {
  return [
    ...layout.countries.map((c) => ({
      kind: 'country' as const,
      label: countryName(c),
      country: c,
    })),
    ...layout.genres.map((g) => ({
      kind: 'genre' as const,
      label: genreLabels.get(g) ?? String(g),
      genre: g,
    })),
  ]
}

export function searchTargets(targets: JumpTarget[], query: string): JumpTarget[] {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return []

  return targets
    .map((t) => ({ t, at: t.label.toLowerCase().indexOf(q) }))
    .filter((r) => r.at >= 0)
    .sort((a, b) => a.at - b.at || a.t.label.localeCompare(b.t.label))
    .slice(0, MAX_RESULTS)
    .map((r) => r.t)
}

export class SearchBox {
  constructor(root: HTMLElement, targets: JumpTarget[], onPick: (t: JumpTarget) => void) {
    const wrap = document.createElement('div')
    wrap.className = 'search'

    const input = document.createElement('input')
    input.type = 'search'
    input.placeholder = 'Jump to a country or genre…'
    input.setAttribute('data-search', '')

    const list = document.createElement('ul')
    list.className = 'search-results'

    const render = (): void => {
      list.replaceChildren()
      for (const t of searchTargets(targets, input.value)) {
        const li = document.createElement('li')
        li.textContent = t.label
        li.addEventListener('mousedown', (e) => {
          e.preventDefault()
          onPick(t)
          input.value = ''
          render()
          input.blur()
        })
        list.appendChild(li)
      }
    }

    input.addEventListener('input', render)
    input.addEventListener('blur', () => setTimeout(() => list.replaceChildren(), 120))

    wrap.append(input, list)
    root.appendChild(wrap)
  }
}
