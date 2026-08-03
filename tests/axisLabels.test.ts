import { describe, it, expect } from 'vitest'
import { AtlasLayout, CELL_COLS, CELL_ROWS } from '../src/atlas/layout'
import { AxisHud } from '../src/ui/axisLabels'

const layout = new AtlasLayout(['us', 'br'], [14, 21])
const labels = new Map([[14, 'Pop'], [21, 'Rock']])

describe('AxisHud', () => {
  it('shows the country and genre under the cursor', () => {
    const root = document.createElement('div')
    const hud = new AxisHud(root, layout, labels)
    hud.update({ col: 0, row: 0 })
    expect(root.textContent).toContain('United States')
    expect(root.textContent).toContain('Pop')
  })

  it('updates when the cursor moves to another cell', () => {
    const root = document.createElement('div')
    const hud = new AxisHud(root, layout, labels)
    hud.update({ col: CELL_COLS, row: CELL_ROWS })
    expect(root.textContent).toContain('Brazil')
    expect(root.textContent).toContain('Rock')
  })

  it('falls back to the raw code for an unknown country', () => {
    const odd = new AtlasLayout(['zq'], [14])
    const root = document.createElement('div')
    new AxisHud(root, odd, labels).update({ col: 0, row: 0 })
    expect(root.textContent).toContain('ZQ')
  })

  it('keeps the last known position when the cursor leaves', () => {
    const root = document.createElement('div')
    const hud = new AxisHud(root, layout, labels)
    hud.update({ col: 0, row: 0 })
    hud.update(null)
    expect(root.textContent).toContain('United States')
  })
})
