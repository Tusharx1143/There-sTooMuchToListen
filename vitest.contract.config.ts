import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['tests/contract/**/*.contract.ts'], testTimeout: 30_000 },
})
