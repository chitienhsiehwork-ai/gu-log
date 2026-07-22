import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildRedirectConfig,
  config,
  LISTING_REDIRECT_COUNT,
  ROUTE_BUDGET,
  RedirectConfigError,
} from '../vercel.mjs';
import {
  buildLegacySurfaces,
  isLegacyUrlPath,
} from '../scripts/verify-canonical-public-output.mjs';

const REPO_ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'quality/brand-taxonomy-post-migration.json');
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

function articlePath(lang: string, slug: string): string {
  return lang === 'en' ? `/en/posts/${slug}` : `/posts/${slug}`;
}

function cloneManifest() {
  return JSON.parse(JSON.stringify(manifest));
}

const EXPECTED_LISTING_REDIRECTS: Array<[string, string]> = [
  ['/shroomdog-picks', '/gu-log-picks'],
  ['/shroomdog-picks/:page(\\d+)', '/gu-log-picks/:page'],
  ['/en/shroomdog-picks', '/en/gu-log-picks'],
  ['/en/shroomdog-picks/:page(\\d+)', '/en/gu-log-picks/:page'],
  ['/clawd-picks', '/mogu-picks'],
  ['/clawd-picks/:page(\\d+)', '/mogu-picks/:page'],
  ['/en/clawd-picks', '/en/mogu-picks'],
  ['/en/clawd-picks/:page(\\d+)', '/en/mogu-picks/:page'],
];

describe('vercel.mjs redirect config — full manifest coverage', () => {
  it('produces exactly one redirect per manifest entry plus the 8 listing rules', () => {
    expect(manifest.entries.length).toBe(manifest.counts.files);
    expect(config.redirects.length).toBe(manifest.entries.length + LISTING_REDIRECT_COUNT);
  });

  it('loads after Vercel relocates the compiled config module under .vercel', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-vercel-config-'));
    const relocatedConfig = path.join(tempDir, 'vercel-temp.mjs');
    try {
      fs.copyFileSync(path.join(REPO_ROOT, 'vercel.mjs'), relocatedConfig);
      expect(() =>
        execFileSync(process.execPath, [relocatedConfig], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
        })
      ).not.toThrow();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('maps every manifest entry to its exact canonical source/destination with permanent:true', () => {
    const bySource = new Map(config.redirects.map((r) => [r.source, r]));
    for (const entry of manifest.entries) {
      const source = articlePath(entry.lang, entry.oldSlug);
      const destination = articlePath(entry.lang, entry.newSlug);
      const redirect = bySource.get(source);
      expect(redirect, `missing redirect for ${source}`).toBeDefined();
      expect(redirect!.destination).toBe(destination);
      expect(redirect!.permanent).toBe(true);
    }
  });

  it('every canonical destination article file exists in the repo', () => {
    for (const entry of manifest.entries) {
      const filePath = path.join(REPO_ROOT, 'src/content/posts', entry.newFilename);
      expect(fs.existsSync(filePath), `missing canonical file for ${entry.newFilename}`).toBe(true);
    }
  });

  it('declares exactly the 8 listing/pagination redirect rules with numeric-only page patterns', () => {
    expect(LISTING_REDIRECT_COUNT).toBe(8);
    const bySource = new Map(config.redirects.map((r) => [r.source, r]));
    for (const [source, destination] of EXPECTED_LISTING_REDIRECTS) {
      const redirect = bySource.get(source);
      expect(redirect, `missing listing redirect for ${source}`).toBeDefined();
      expect(redirect!.destination).toBe(destination);
      expect(redirect!.permanent).toBe(true);
    }
    const listingSources = config.redirects
      .map((r) => r.source)
      .filter((source) => /^\/(?:en\/)?(?:shroomdog-picks|clawd-picks)/.test(source));
    expect(listingSources.sort()).toEqual(
      EXPECTED_LISTING_REDIRECTS.map(([source]) => source).sort()
    );
    for (const source of listingSources) {
      expect(source).not.toContain(':path*');
    }
  });

  it('has no duplicate sources, no duplicate destinations, and no self-loops', () => {
    const sources = config.redirects.map((r) => r.source);
    const destinations = config.redirects.map((r) => r.destination);
    expect(new Set(sources).size).toBe(sources.length);
    expect(new Set(destinations).size).toBe(destinations.length);
    for (const redirect of config.redirects) {
      expect(redirect.source).not.toBe(redirect.destination);
    }
  });

  it('stays within the documented Vercel route budget', () => {
    expect(config.redirects.length).toBeLessThan(ROUTE_BUDGET);
  });

  it('does not map unmapped legacy surfaces (never-published listing, unknown slugs, API, artifacts, assets)', () => {
    const sources = new Set(config.redirects.map((r) => r.source));
    const negativeScopes = [
      '/shroom-picks',
      '/en/shroom-picks',
      '/posts/definitely-unknown-legacy-slug',
      '/en/posts/definitely-unknown-legacy-slug',
      '/api/posts/sp-1-example.json',
      '/artifacts/sp-1-example/',
      '/clawd-icon.png',
      '/shroomdog-picks/not-a-page',
      '/clawd-picks/abc',
      '/shroomdog-picks/1/deep/path',
    ];
    for (const scope of negativeScopes) {
      expect(sources.has(scope), `unexpectedly mapped ${scope}`).toBe(false);
    }
  });
});

describe('buildRedirectConfig — fail-closed validation', () => {
  it('rejects a non-object manifest', () => {
    expect(() => buildRedirectConfig(null)).toThrow(RedirectConfigError);
  });

  it('rejects an unsupported schemaVersion', () => {
    const bad = cloneManifest();
    bad.schemaVersion = 2;
    expect(() => buildRedirectConfig(bad)).toThrow(/schemaVersion/);
  });

  it('rejects an empty entries array', () => {
    const bad = cloneManifest();
    bad.entries = [];
    expect(() => buildRedirectConfig(bad)).toThrow(/entries/);
  });

  it('rejects counts inconsistent with the manifest', () => {
    const bad = cloneManifest();
    bad.counts = { ...bad.counts, files: bad.entries.length - 1 };
    expect(() => buildRedirectConfig(bad)).toThrow(/counts\.files/);
  });

  it('rejects an unsupported language', () => {
    const bad = cloneManifest();
    bad.entries[0].lang = 'ja';
    expect(() => buildRedirectConfig(bad)).toThrow(/lang/);
  });

  it('rejects an empty or unsafe slug', () => {
    const emptySlug = cloneManifest();
    emptySlug.entries[0].oldSlug = '';
    expect(() => buildRedirectConfig(emptySlug)).toThrow(RedirectConfigError);

    const unsafeSlug = cloneManifest();
    unsafeSlug.entries[0].newSlug = '../etc/passwd';
    expect(() => buildRedirectConfig(unsafeSlug)).toThrow(RedirectConfigError);
  });

  it('rejects a self-loop entry', () => {
    const bad = cloneManifest();
    bad.entries[0].newSlug = bad.entries[0].oldSlug;
    expect(() => buildRedirectConfig(bad)).toThrow(/self-loop/);
  });

  it('rejects a duplicate redirect source across entries', () => {
    const bad = cloneManifest();
    bad.entries[1] = {
      ...bad.entries[1],
      lang: bad.entries[0].lang,
      oldSlug: bad.entries[0].oldSlug,
      newSlug: `${bad.entries[1].newSlug}-x`,
    };
    expect(() => buildRedirectConfig(bad)).toThrow(/duplicate redirect source/);
  });

  it('rejects a duplicate redirect destination across entries', () => {
    const bad = cloneManifest();
    bad.entries[1] = {
      ...bad.entries[1],
      lang: bad.entries[0].lang,
      oldSlug: `${bad.entries[1].oldSlug}-x`,
      newSlug: bad.entries[0].newSlug,
    };
    expect(() => buildRedirectConfig(bad)).toThrow(/duplicate redirect destination/);
  });

  it('fails closed when the route count is at/over the documented budget', () => {
    const bad = cloneManifest();
    const template = bad.entries[0];
    const neededArticleCount = ROUTE_BUDGET - LISTING_REDIRECT_COUNT;
    const fillerCount = Math.max(0, neededArticleCount - bad.entries.length);
    const filler = Array.from({ length: fillerCount }, (_, i) => ({
      ...template,
      lang: 'zh-tw',
      oldSlug: `budget-filler-${i}`,
      newSlug: `budget-filler-new-${i}`,
    }));
    bad.entries = [...bad.entries, ...filler];
    bad.counts = { ...bad.counts, files: bad.entries.length };
    expect(() => buildRedirectConfig(bad)).toThrow(/route budget/);
  });
});

describe('verify-canonical-public-output — pass/fail boundary', () => {
  const legacy = buildLegacySurfaces(manifest);

  it('flags every manifest entry old article path as legacy', () => {
    for (const entry of manifest.entries) {
      const oldPath = articlePath(entry.lang, entry.oldSlug);
      expect(isLegacyUrlPath(oldPath, legacy), `expected ${oldPath} to be legacy`).toBe(true);
    }
  });

  it('does not flag any manifest entry new article path as legacy', () => {
    for (const entry of manifest.entries) {
      const newPath = articlePath(entry.lang, entry.newSlug);
      expect(isLegacyUrlPath(newPath, legacy), `did not expect ${newPath} to be legacy`).toBe(
        false
      );
    }
  });

  it('flags retired listing bases and their numeric-page paths as legacy', () => {
    for (const legacyPath of [
      '/shroomdog-picks',
      '/shroomdog-picks/2',
      '/en/shroomdog-picks',
      '/en/shroomdog-picks/2',
      '/clawd-picks',
      '/clawd-picks/2',
      '/en/clawd-picks',
      '/en/clawd-picks/2',
    ]) {
      expect(isLegacyUrlPath(legacyPath, legacy), `expected ${legacyPath} to be legacy`).toBe(true);
    }
  });

  it('does not flag canonical listing bases, unrelated legacy machine paths, or a never-published listing', () => {
    for (const safePath of [
      '/gu-log-picks',
      '/gu-log-picks/2',
      '/mogu-picks',
      '/en/mogu-picks/2',
      '/shroom-picks',
      '/en/shroom-picks',
      '/api/posts/sp-1-example.json',
      '/artifacts/sp-1-example/',
    ]) {
      expect(isLegacyUrlPath(safePath, legacy), `did not expect ${safePath} to be legacy`).toBe(
        false
      );
    }
  });
});
