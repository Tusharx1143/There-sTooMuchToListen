import { test, expect, type Page } from '@playwright/test'

/** The intro tween runs for INTRO_MS; clicks are ignored until it lands. */
const INTRO_SETTLE_MS = 3200

/** Past the unlock gate, with the atlas settled enough to interact with. */
async function ready(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('[data-unlock]').click()
  await page.mouse.move(640, 400)
  await page.waitForTimeout(300)
}

/** As `ready`, but also past the intro reveal, so the world has stopped moving. */
async function readySettled(page: Page, x = 700, y = 450): Promise<void> {
  await page.goto('/')
  await page.locator('[data-unlock]').click()
  await page.mouse.move(x, y)
  await page.waitForTimeout(INTRO_SETTLE_MS)
}

// The default theme is `system`, so the OS preference has to be pinned or the
// starting point of every theme assertion depends on the runner's environment.
test.use({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' })

test('the toolbar offers three labelled controls', async ({ page }) => {
  await ready(page)
  const bar = page.locator('[data-toolbar]')
  await expect(bar).toBeVisible()
  await expect(bar.locator('.tool-btn')).toHaveCount(3)

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

/** No repository link anywhere in the chrome — panel or toolbar. */
test('the chrome carries no source link', async ({ page }) => {
  await ready(page)
  await expect(page.locator('[data-toolbar] a')).toHaveCount(0)

  await page.locator('[data-about]').click()
  const panel = page.locator('[data-panel="About"]')
  await expect(panel).toBeVisible()
  await expect(panel.locator('a')).toHaveCount(0)
})

test('an open panel hides the hover readout they would otherwise overlap', async ({ page }) => {
  await readySettled(page)

  const label = page.locator('[data-hover-label]')
  await expect(label.locator('h2')).not.toBeEmpty({ timeout: 15000 })

  await page.locator('[data-about]').click()
  await expect
    .poll(async () => Number(await label.evaluate((el) => (el as HTMLElement).style.opacity)), {
      timeout: 5000,
    })
    .toBeLessThan(0.05)

  await page.keyboard.press('Escape')
  await expect
    .poll(async () => Number(await label.evaluate((el) => (el as HTMLElement).style.opacity)), {
      timeout: 5000,
    })
    .toBeGreaterThan(0.9)
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

test('the hover readout names the song under the lens once it parks', async ({ page }) => {
  await readySettled(page)

  const label = page.locator('[data-hover-label]')
  await expect(label.locator('h2')).not.toBeEmpty({ timeout: 15000 })
  await expect
    .poll(async () => Number(await label.evaluate((el) => (el as HTMLElement).style.opacity)), {
      timeout: 10000,
    })
    .toBeGreaterThan(0.9)
})

/** The point of fading it: sweeping must not strobe a title per tile crossed. */
test('the hover readout fades out while the lens travels', async ({ page }) => {
  await readySettled(page)

  const label = page.locator('[data-hover-label]')
  await expect(label.locator('h2')).not.toBeEmpty({ timeout: 15000 })

  await page.mouse.move(1250, 780)
  await page.waitForTimeout(80)
  const moving = Number(await label.evaluate((el) => (el as HTMLElement).style.opacity))
  expect(moving).toBeLessThan(0.4)

  await expect
    .poll(async () => Number(await label.evaluate((el) => (el as HTMLElement).style.opacity)), {
      timeout: 10000,
    })
    .toBeGreaterThan(0.9)
})

test('pinning a song hands the readout to the now-playing card', async ({ page }) => {
  await readySettled(page)

  const label = page.locator('[data-hover-label]')
  await expect(label.locator('h2')).not.toBeEmpty({ timeout: 15000 })

  await page.mouse.click(700, 450)
  await expect(page.locator('[data-now-playing]')).toBeVisible()
  await expect
    .poll(async () => Number(await label.evaluate((el) => (el as HTMLElement).style.opacity)), {
      timeout: 5000,
    })
    .toBeLessThan(0.05)
})

/**
 * Pinning locks the audio, it does not end the browsing session. Suppressing
 * the readout for the whole pinned session left no discoverable way back.
 */
test('the hover readout returns on other songs after one is pinned', async ({ page }) => {
  await readySettled(page)

  const label = page.locator('[data-hover-label]')
  await expect(label.locator('h2')).not.toBeEmpty({ timeout: 15000 })

  const pinnedTitle = await label.locator('h2').textContent()
  await page.mouse.click(700, 450)
  await expect(page.locator('[data-now-playing]')).toBeVisible()

  // Move off the pinned tile — far enough to be a different song.
  await page.mouse.move(430, 300)
  await expect
    .poll(async () => Number(await label.evaluate((el) => (el as HTMLElement).style.opacity)), {
      timeout: 15000,
    })
    .toBeGreaterThan(0.9)
  expect(await label.locator('h2').textContent()).not.toBe(pinnedTitle)
})

test('the intro shows the headline and clears on start', async ({ page }) => {
  await page.goto('/')
  const overlay = page.locator('[data-unlock]')
  await expect(overlay).toBeVisible()
  await expect(overlay).toContainText('too much to listen to')

  await page.locator('[data-unlock-start]').click()
  await expect(overlay).toHaveCount(0)
})

/**
 * The tween's maths is covered in the unit tests, which can read the layout
 * directly. From out here the observable is that the atlas is still visibly
 * rebuilding after the overlay clears, and that it does so without throwing.
 */
test('the intro reveal runs and settles without errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('/')
  await page.locator('[data-unlock-start]').click()

  await page.waitForTimeout(150)
  const early = await sampleCanvas(page)

  await page.waitForTimeout(3200)
  expect(await sampleCanvas(page)).not.toEqual(early)
  expect(errors).toEqual([])
})

test('the depth preset changes what the atlas renders', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await ready(page)
  await page.locator('[data-settings]').click()
  await expect(page.locator('[data-option="minimal"]')).toHaveAttribute('aria-pressed', 'true')

  const flat = await sampleCanvas(page)
  await page.locator('[data-option="depth"]').click()
  await expect(page.locator('[data-option="depth"]')).toHaveAttribute('aria-pressed', 'true')
  await page.waitForTimeout(600)

  expect(await sampleCanvas(page)).not.toEqual(flat)
  expect(errors).toEqual([])
})

test('the render preset survives a reload', async ({ page }) => {
  await ready(page)
  await page.locator('[data-settings]').click()
  await page.locator('[data-option="depth"]').click()

  await page.reload()
  await page.locator('[data-unlock]').click()
  await page.locator('[data-settings]').click()
  await expect(page.locator('[data-option="depth"]')).toHaveAttribute('aria-pressed', 'true')
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
