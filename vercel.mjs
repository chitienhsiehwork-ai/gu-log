// @ts-check
// Programmatic Vercel redirect config for the Mogu/GP/MP rebrand's public URL
// compatibility boundary. Reader-facing legacy URLs stay reachable via exact
// permanent (308) redirects; every other legacy surface (frontmatter, API,
// Reader, pipeline, artifacts, assets) stays unmapped/404 per
// openspec/specs/brand-taxonomy/spec.md.
//
// The migration manifest (quality/brand-taxonomy-post-migration.json) is the
// single source of truth for old->new article slugs. This file does not hand
// -author or duplicate that mapping; it only shapes it into Vercel's
// redirects schema and fails closed on anything that looks wrong.
import fs from 'node:fs';
import path from 'node:path';
import { cwd } from 'node:process';

// Vercel compiles this file to `.vercel/vercel-temp.mjs` before importing it,
// so `import.meta.url` no longer points at the repository root. Config loading
// runs with the project root as cwd; resolve the manifest from that stable
// deployment contract instead of the temporary compiled module location.
const ROOT = cwd();
const MANIFEST_PATH = path.join(ROOT, 'quality/brand-taxonomy-post-migration.json');

// Vercel's vercel.json redirects/rewrites/headers share one "Routes created
// per Deployment" budget, documented as 2048 static routes per project.
// https://vercel.com/docs/limits
// Larger scale would require paid Bulk Redirects, which this design
// explicitly rejects (see design.md Alternatives considered) -- so this
// budget must stay a hard fail-closed gate, not a soft warning.
export const ROUTE_BUDGET = 2048;

const SUPPORTED_LANGS = new Set(['zh-tw', 'en']);
const SAFE_SLUG = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const MARKDOWN_HEADERS = Object.freeze([
  {
    source: '/posts/:slug.md',
    headers: [{ key: 'Content-Type', value: 'text/markdown; charset=utf-8' }],
  },
  {
    source: '/en/posts/:slug.md',
    headers: [{ key: 'Content-Type', value: 'text/markdown; charset=utf-8' }],
  },
]);

// The only two retired public listing namespaces that ever actually existed.
// Deep/arbitrary listing paths, the never-published `/shroom-picks`, and any
// other legacy namespace intentionally have no entry here and stay unmapped.
export const LISTING_SERIES = [
  { oldBase: 'shroomdog-picks', newBase: 'gu-log-picks' },
  { oldBase: 'clawd-picks', newBase: 'mogu-picks' },
];
export const LANG_PREFIXES = ['', '/en'];

// 2 series x 2 lang prefixes x (exact base + numeric-page-only) = 8.
export const LISTING_REDIRECT_COUNT = LISTING_SERIES.length * LANG_PREFIXES.length * 2;

export class RedirectConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RedirectConfigError';
  }
}

/**
 * @param {{
 *   headers?: readonly unknown[],
 *   redirects?: readonly unknown[],
 *   rewrites?: readonly unknown[]
 * }} routeConfig
 */
export function countPlatformRoutes({ headers = [], redirects = [], rewrites = [] }) {
  return headers.length + redirects.length + rewrites.length;
}

/**
 * @param {{
 *   headers?: readonly unknown[],
 *   redirects?: readonly unknown[],
 *   rewrites?: readonly unknown[]
 * }} routeConfig
 */
export function assertRouteBudget(routeConfig) {
  const routeCount = countPlatformRoutes(routeConfig);
  if (routeCount >= ROUTE_BUDGET) {
    throw new RedirectConfigError(
      `platform route count ${routeCount} is at/over the documented Vercel route budget ${ROUTE_BUDGET}`
    );
  }
  return routeCount;
}

function articlePath(lang, slug) {
  return lang === 'en' ? `/en/posts/${slug}` : `/posts/${slug}`;
}

/** Accumulates redirects while failing closed on self-loops and collisions. */
function createRedirectRegistry() {
  const seenSources = new Set();
  const seenDestinations = new Set();
  const redirects = [];
  return {
    add(source, destination) {
      if (source === destination) {
        throw new RedirectConfigError(`redirect self-loop: ${source}`);
      }
      if (seenSources.has(source)) {
        throw new RedirectConfigError(`duplicate redirect source: ${source}`);
      }
      if (seenDestinations.has(destination)) {
        throw new RedirectConfigError(`duplicate redirect destination: ${destination}`);
      }
      seenSources.add(source);
      seenDestinations.add(destination);
      redirects.push({ source, destination, permanent: true });
    },
    redirects,
  };
}

function assertSafeSlug(label, value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RedirectConfigError(`${label} must be a non-empty string`);
  }
  if (!SAFE_SLUG.test(value)) {
    throw new RedirectConfigError(`${label} has unsafe characters: ${JSON.stringify(value)}`);
  }
}

function assertSlugMatchesFilename(label, filenameLabel, filename, slugLabel, slug, filenameRole) {
  if (typeof filename !== 'string' || !filename.endsWith('.mdx')) {
    throw new RedirectConfigError(`${label}.${filenameLabel} must be an .mdx filename`);
  }
  if (path.basename(filename) !== filename) {
    throw new RedirectConfigError(`${label}.${filenameLabel} must not contain a path`);
  }
  const expectedSlug = filename.slice(0, -'.mdx'.length).toLowerCase();
  if (slug !== expectedSlug) {
    throw new RedirectConfigError(
      `${label}.${slugLabel} must match lowercase ${filenameRole} filename stem ${JSON.stringify(expectedSlug)}`
    );
  }
}

/**
 * Builds the Vercel redirects array from a parsed migration manifest.
 * Pure function (no filesystem access) so tests can exercise fail-closed
 * behavior against synthetic manifests without touching the real one.
 */
export function buildRedirectConfig(manifest) {
  if (manifest === null || typeof manifest !== 'object') {
    throw new RedirectConfigError('manifest must be an object');
  }
  if (manifest.schemaVersion !== 1) {
    throw new RedirectConfigError(`unsupported manifest schemaVersion: ${manifest.schemaVersion}`);
  }
  const entries = manifest.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new RedirectConfigError('manifest.entries must be a non-empty array');
  }
  const declaredCount = manifest.counts?.files;
  if (declaredCount !== entries.length) {
    throw new RedirectConfigError(
      `manifest.counts.files (${declaredCount}) does not match entries.length (${entries.length})`
    );
  }

  const registry = createRedirectRegistry();

  entries.forEach((entry, index) => {
    const label = `entries[${index}]`;
    if (!entry || typeof entry !== 'object') {
      throw new RedirectConfigError(`${label} must be an object`);
    }
    if (!SUPPORTED_LANGS.has(entry.lang)) {
      throw new RedirectConfigError(`${label}: unsupported lang ${JSON.stringify(entry.lang)}`);
    }
    assertSafeSlug(`${label}.oldSlug`, entry.oldSlug);
    assertSafeSlug(`${label}.newSlug`, entry.newSlug);
    assertSlugMatchesFilename(
      label,
      'oldFilename',
      entry.oldFilename,
      'oldSlug',
      entry.oldSlug,
      'evidence'
    );
    assertSlugMatchesFilename(
      label,
      'newFilename',
      entry.newFilename,
      'newSlug',
      entry.newSlug,
      'content'
    );
    registry.add(articlePath(entry.lang, entry.oldSlug), articlePath(entry.lang, entry.newSlug));
  });

  for (const { oldBase, newBase } of LISTING_SERIES) {
    for (const prefix of LANG_PREFIXES) {
      registry.add(`${prefix}/${oldBase}`, `${prefix}/${newBase}`);
      registry.add(`${prefix}/${oldBase}/:page(\\d+)`, `${prefix}/${newBase}/:page`);
    }
  }

  assertRouteBudget({ redirects: registry.redirects });

  return { redirects: registry.redirects };
}

function loadManifest(manifestPath = MANIFEST_PATH) {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

const redirectConfig = buildRedirectConfig(loadManifest());
const platformRoutes = { ...redirectConfig, headers: MARKDOWN_HEADERS };
assertRouteBudget(platformRoutes);

export const config = {
  ...platformRoutes,
  git: {
    deploymentEnabled: {
      // GitHub CI fully validates workflow-only Dependabot updates; skipping
      // their site previews preserves the single Hobby build slot for code PRs.
      'dependabot/github_actions/**': false,
    },
  },
};
