import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/pages/reading-tracker.astro', import.meta.url), 'utf8');

describe('reading tracker semantic status colors', () => {
  it('themes sync badge foregrounds and backgrounds through status tokens', () => {
    expect(source).toContain('var(--color-status-success)');
    expect(source).toContain('var(--color-status-warning)');
    expect(source).toContain('var(--color-status-danger)');
    expect(source).toContain('var(--color-status-neutral)');
    expect(source).toContain(
      'color-mix(in srgb, var(--color-status-danger) 30%, var(--color-text))'
    );
    expect(source).toContain(":global([data-theme='light']) .sync-status-badge.sync-status-error");
    expect(source).toContain('color-mix(in srgb, var(--color-status-success) 8%, transparent)');
    expect(source).toContain('color-mix(in srgb, var(--color-status-warning) 8%, transparent)');
    expect(source).toContain('color-mix(in srgb, var(--color-status-danger) 8%, transparent)');
  });

  it('does not retain the legacy Dracula sync-status colors', () => {
    expect(source).not.toContain('rgba(80, 250, 123, 0.08)');
    expect(source).not.toContain('rgba(255, 184, 108, 0.08)');
    expect(source).not.toContain('#ff5555');
  });

  it('fails the build when the configured API URL is not HTTP(S)', () => {
    expect(source).toContain('new URL(configuredApiUrl)');
    expect(source).toContain("parsedApiUrl.protocol !== 'https:'");
    expect(source).toContain("parsedApiUrl.protocol !== 'http:'");
    expect(source).toContain('PUBLIC_API_URL must use http or https');
  });
});
