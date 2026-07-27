import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const globalCss = readFileSync(new URL('src/styles/global.css', root), 'utf8');
const baseLayout = readFileSync(new URL('src/layouts/BaseLayout.astro', root), 'utf8');

const sharedComponents = [
  {
    file: 'Toggle.astro',
    selectors: [
      '.toggle-container {',
      '.toggle-container .toggle-header {',
      '.toggle-container .toggle-content p:last-child {',
    ],
  },
  {
    file: 'TicketBadge.astro',
    selectors: [
      '.ticket-wrapper {',
      '.ticket-wrapper .ticket-badge {',
      '.ticket-wrapper .ticket-label {',
    ],
  },
  {
    file: 'PostStatusLabel.astro',
    selectors: [
      '.post-status-label {',
      '.post-status-label.post-status-label--deprecated {',
      '.post-status-label.post-status-label--retired {',
    ],
  },
  {
    file: 'Pagination.astro',
    selectors: [
      '.pagination {',
      '.pagination .pagination-row {',
      '.pagination .pagination-link {',
      '.pagination a.pagination-link:hover {',
      '.pagination a.pagination-link:focus-visible {',
    ],
  },
] as const;

describe('shared high-fanout component styles', () => {
  it('loads global.css once through BaseLayout', () => {
    expect(baseLayout).toMatch(
      /<style is:global>\s*@import '\.\.\/styles\/global\.css';\s*<\/style>/
    );
  });

  it.each(sharedComponents)(
    'keeps $file styles in the shared BaseLayout asset',
    ({ file, selectors }) => {
      const component = readFileSync(new URL(`src/components/${file}`, root), 'utf8');

      expect(component).not.toMatch(/<style(?:\s|>)/);
      for (const selector of selectors) {
        expect(globalCss).toContain(selector);
      }
    }
  );
});
