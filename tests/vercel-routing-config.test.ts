import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..');
const PICKS_ROUTE_RE =
  /^\/(?:en\/)?(?:gu-log-picks|mogu-picks|clawd-picks|shroom(?:dog)?-picks)(?:\/:path\*|\/.*)?$/;

describe('Vercel routing configuration', () => {
  it('does not redirect canonical or retired Picks routes', () => {
    const configPath = path.join(REPO_ROOT, 'vercel.json');
    const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};

    for (const redirect of config.redirects ?? []) {
      expect(PICKS_ROUTE_RE.test(redirect.source)).toBe(false);
      expect(PICKS_ROUTE_RE.test(redirect.destination)).toBe(false);
    }
  });
});
