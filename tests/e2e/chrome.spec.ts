import { test, expect, type Page } from '@playwright/test'

/** Past the unlock gate, with the atlas settled enough to interact with. */
async function ready(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('[data-unlock]').click()
  await page.mouse.move(640, 400)
  await page.waitForTimeout(300)
}

// The default theme is `system`, so the OS preference has to be pinned or the
// starting point of every theme assertion depends on the runner's environment.
test.use({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' })

test('the toolbar offers four labelled controls', async ({ page }) => {
  await ready(page)
  const bar = page.locator('[data-toolbar]')
  await expect(bar).toBeVisible()
  await expect(bar.locator('.tool-btn')).toHaveCount(4)

  // Anchored to the top-right, clear of the search box now on the left.
  const bounds = (await bar.boundingBox())!
  expect(bounds.x + bounds.width).toBeGreaterThan(1280 - 40)
  const search = (await page.locator('.search').boundingBox())!
  expect(search.x).toBeLessThan(100)
})

test('the about panel opens, expands a section, and closes on Escape', async ({ page }) => {
  await ready(page)
  const panel = page.locator('[data-panel="About"]')
  await expect(panel).toBeHidden()

  await page.locator('[data-about]').click()
  await expect(panel).toBeVisible()
  await expect(page.locator('[data-about]')).toHaveAttribute('aria-expanded', 'true')

  // Second section starts collapsed; clicking it opens it.
  const trigger = panel.locator('.acc-trigger').nth(1)
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')

  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(page.locator('[data-about]')).toHaveAttribute('aria-expanded', 'false')
})

test('only one panel is open at a time', async ({ page }) => {
  await ready(page)
  await page.locator('[data-about]').click()
  await expect(page.locator('[data-panel="About"]')).toBeVisible()

  await page.locator('[data-settings]').click()
  await expect(page.locator('[data-panel="Settings"]')).toBeVisible()
  await expect(page.locator('[data-panel="About"]')).toBeHidden()
})

test('the theme toggle repaints both the chrome and the canvas', async ({ page }) => {
  await ready(page)
  const html = page.locator('html')
  await expect(html).toHaveAttribute('data-theme', 'dark')

  const darkPixel = await sampleCanvas(page)
  await page.locator('[data-theme-toggle]').click()
  await expect(html).toHaveAttribute('data-theme', 'light')
  await page.waitForTimeout(300)

  // The canvas is most of the app; a chrome-only theme would leave it black.
  const lightPixel = await sampleCanvas(page)
  expect(lightPixel).not.toEqual(darkPixel)
  expect(sum(lightPixel)).toBeGreaterThan(sum(darkPixel))
})

test('the theme choice survives a reload', async ({ page }) => {
  await ready(page)
  await page.locator('[data-theme-toggle]').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

test('changing tile size redraws the atlas without errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await ready(page)
  await page.locator('[data-settings]').click()

  const before = await sampleCanvas(page)
  await page.locator('[data-option="large"]').click()
  await expect(page.locator('[data-option="large"]')).toHaveAttribute('aria-pressed', 'true')
  await page.waitForTimeout(500)

  expect(await sampleCanvas(page)).not.toEqual(before)
  expect(errors).toEqual([])
})

test('the lens can be turned off', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await ready(page)
  await page.locator('[data-settings]').click()
  await page.locator('[data-option="off"]').click()
  await page.mouse.move(500, 500)
  await page.waitForTimeout(400)

  await expect(page.locator('[data-option="off"]')).toHaveAttribute('aria-pressed', 'true')
  expect(errors).toEqual([])
})

test('volume and mute persist through the settings panel', async ({ page }) => {
  await ready(page)
  await page.locator('[data-settings]').click()

  await page.locator('[data-volume]').fill('0.25')
  // The checkbox itself is visually hidden behind the switch track, as the
  // pattern requires; the label is what a user actually hits.
  await page.locator('.switch', { has: page.locator('[data-mute]') }).click()
  await expect(page.locator('[data-mute]')).toBeChecked()
  await page.reload()
  await page.locator('[data-unlock]').click()
  await page.locator('[data-settings]').click()

  await expect(page.locator('[data-volume]')).toHaveValue('0.25')
  await expect(page.locator('[data-mute]')).toBeChecked()
})

/** Average colour of a patch away from the lens, as [r, g, b]. */
async function sampleCanvas(page: Page): Promise<[number, number, number]> {
  return page.evaluate(() => {
    const c = document.querySelector('canvas#atlas') as HTMLCanvasElement
    const ctx = c.getContext('2d')!
    const d = ctx.getImageData(40, 40, 60, 60).data
    let r = 0
    let g = 0
    let b = 0
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]!
      g += d[i + 1]!
      b += d[i + 2]!
    }
    const n = d.length / 4
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)] as [number, number, number]
  })
}

function sum([r, g, b]: [number, number, number]): number {
  return r + g + b
}
