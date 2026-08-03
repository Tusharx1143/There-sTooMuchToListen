// Must come from 'vitest/config', not 'vite' — Vite's own config type has no
// `test` key, and `tsc --noEmit` in Step 6 will reject it.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { globals: true, environment: 'jsdom' },
})
