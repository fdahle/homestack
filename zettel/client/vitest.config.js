import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Per-file environment is set via a `// @vitest-environment` comment where
    // a DOM is needed (markdown/DOMPurify). Default to fast node env.
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
})
