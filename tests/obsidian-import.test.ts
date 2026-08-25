import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'obsidian-import.mjs');
const FIXTURES = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-obsidian-import-'));
const TEST_MODEL = 'Test Model 1.0';
const TEST_HARNESS = 'Test Harness';

afterAll(() => {
  fs.rmSync(FIXTURES, { recursive: true, force: true });
});

function writeDraft(
  name: string,
  {
    series,
    model,
    harness,
  }: {
    series: 'SD' | 'GP' | 'MP';
    model?: string;
    harness?: string;
  }
): string {
  const source =
    series === 'GP' || series === 'MP'
      ? ['source: "@example on X"', 'sourceUrl: "https://x.com/example/status/1"']
      : [];
  const provenance = [
    ...(model === undefined ? [] : [`model: ${JSON.stringify(model)}`]),
    ...(harness === undefined ? [] : [`harness: ${JSON.stringify(harness)}`]),
  ];
  const draftPath = path.join(FIXTURES, path.basename(name));

  fs.writeFileSync(
    draftPath,
    [
      '---',
      `series: ${series}`,
      `title: "${series} provenance fixture"`,
      'summary: "Regression fixture"',
      ...source,
      ...provenance,
      '---',
      '',
      'Fixture body.',
      '',
    ].join('\n')
  );

  return draftPath;
}

function runImport(draftPath: string) {
  return spawnSync(process.execPath, [SCRIPT, draftPath, '--dry-run'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

describe('obsidian-import provenance', () => {
  it.each([
    { series: 'SD' as const, missing: 'model' as const },
    { series: 'SD' as const, missing: 'harness' as const },
    { series: 'GP' as const, missing: 'model' as const },
    { series: 'GP' as const, missing: 'harness' as const },
  ])(
    'GIVEN a $series draft missing $missing WHEN dry-run imports THEN it fails without fabricated output',
    ({ series, missing }) => {
      const draftPath = writeDraft(`${series.toLowerCase()}-missing-${missing}.md`, {
        series,
        model: missing === 'model' ? undefined : TEST_MODEL,
        harness: missing === 'harness' ? undefined : TEST_HARNESS,
      });

      const result = runImport(draftPath);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain(`frontmatter 缺 ${missing}`);
    }
  );

  it.each([
    { series: 'SD' as const, blank: 'model' as const },
    { series: 'GP' as const, blank: 'harness' as const },
  ])(
    'GIVEN a $series draft with blank $blank WHEN dry-run imports THEN it fails before output',
    ({ series, blank }) => {
      const draftPath = writeDraft(`${series.toLowerCase()}-blank-${blank}.md`, {
        series,
        model: blank === 'model' ? '   ' : TEST_MODEL,
        harness: blank === 'harness' ? '   ' : TEST_HARNESS,
      });

      const result = runImport(draftPath);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain(`frontmatter 缺 ${blank}`);
    }
  );

  it.each([
    { series: 'SD' as const, role: 'Author' },
    { series: 'GP' as const, role: 'Translator' },
    { series: 'MP' as const, role: 'Author' },
  ])(
    'GIVEN explicit $series provenance WHEN dry-run imports THEN it preserves metadata with the $role role',
    ({ series, role }) => {
      const draftPath = writeDraft(`${series.toLowerCase()}-explicit.md`, {
        series,
        model: TEST_MODEL,
        harness: TEST_HARNESS,
      });

      const result = runImport(draftPath);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout.match(/model: "Test Model 1\.0"/g)).toHaveLength(2);
      expect(result.stdout.match(/harness: "Test Harness"/g)).toHaveLength(2);
      expect(result.stdout).toContain(`role: "${role}"`);
    }
  );
});
