import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcRoot = fileURLToPath(new URL('../src', import.meta.url));

function read(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:astro|[cm]?[jt]s)$/.test(entry.name) ? [path] : [];
  });
}

describe('PUBLIC_API_URL consumers', () => {
  it('routes every current and future env consumer through a shared fail-closed helper', () => {
    const consumers = sourceFiles(srcRoot).filter((path) =>
      readFileSync(path, 'utf8').includes('import.meta.env.PUBLIC_API_URL')
    );
    const bypasses = consumers
      .filter((path) => {
        const source = readFileSync(path, 'utf8');
        return (
          !source.includes('buildPublicApiEndpoint(') &&
          !source.includes('normalizePublicApiBaseUrl(')
        );
      })
      .map((path) => relative(srcRoot, path));

    expect(consumers.length).toBeGreaterThan(0);
    expect(bypasses).toEqual([]);
  });

  it('builds the reading tracker OAuth query from a validated endpoint', () => {
    const source = read('src/pages/reading-tracker.astro');

    expect(source).toContain("buildPublicApiEndpoint(configuredApiUrl, '/auth/github')");
    expect(source).toContain("syncLoginUrl.searchParams.set('reader_sync', '1')");
    expect(source).toContain('href={syncLoginUrl.href}');
  });
});
