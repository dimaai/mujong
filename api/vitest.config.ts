import { defineConfig } from 'vitest/config';

// Scoped Vitest config for the signaling backend. Without this,
// running `vitest` from `api/` walks up the tree and picks up
// the root `vitest.config.ts`, which fails in CI because the
// root project's deps aren't installed in the api-only job.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
  },
});
