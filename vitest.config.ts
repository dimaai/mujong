import { defineConfig } from 'vitest/config';

// Keep the root vitest run scoped to the Next.js app. The
// signaling backend in `api/` ships with its own package.json
// + tsconfig and is tested via `npm --prefix api test`.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', 'api/**', '.next/**', 'out/**'],
  },
});
