import { test, expect } from '@playwright/test'

test('unlock, hover, and hear a preview', async ({ page }) => {
  const played: string[] = []
  await page.exposeFunction('__recordPlay', (src: string) => { played.push(src) })

  await page.addInitScript(() => {
    const original = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      ;(window as any).__recordPlay?.(this.src)
      return original.call(this).catch(() => undefined)
    }
  })

  await page.goto('/')

  // The unlock overlay gates audio.
  const overlay = page.locator('[data-unlock]')
  await expect(overlay).toBeVisible()
  await overlay.click()
  await expect(overlay).toHaveCount(0)

  // Settle the cursor mid-canvas and wait past the debounce.
  await page.mouse.move(640, 400)
  await page.waitForTimeout(600)

  expect(played.length).toBeGreaterThan(0)
  expect(played[0]).toMatch(/^https?:\/\//)
})

test('the axis readout names a country and genre', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-unlock]').click()
  await page.mouse.move(640, 400)
  await expect(page.locator('[data-axis-hud]')).not.toBeEmpty()
})

test('dragging pans the atlas without errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('/')
  await page.locator('[data-unlock]').click()
  await page.mouse.move(640, 400)
  await page.mouse.down()
  await page.mouse.move(300, 250, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(400)

  expect(errors).toEqual([])
})
