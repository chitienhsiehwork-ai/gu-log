import { getViteConfig } from 'astro/config';

export default getViteConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Exclude playwright e2e tests (they use .spec.ts)
    exclude: ['tests/**/*.spec.ts', 'tests/**/pseudo/**', 'node_modules'],
  },
});
