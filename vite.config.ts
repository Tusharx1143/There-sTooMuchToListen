// Must come from 'vitest/config', not 'vite' — Vite's own config type has no
// `test` key, and `tsc --noEmit` in Step 6 will reject it.
import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    // Playwright owns tests/e2e — it has its own runner and test() signature
    // that collides with vitest's globals.
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
  },
})
