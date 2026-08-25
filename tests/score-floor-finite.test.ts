import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT_PATH = path.resolve(import.meta.dirname, '../scripts/score-floor-check.mjs');

function runFloorCheck(vibe: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-score-floor-'));
  const post = path.join(root, 'post.mdx');
  fs.writeFileSync(
    post,
    `---
scores:
  tribunalVersion: 9
  vibe:
${vibe}
---
body
`
  );

  try {
    return spawnSync(process.execPath, [SCRIPT_PATH, post], {
      encoding: 'utf8',
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('score floor finite-number contract', () => {
  it('rejects a non-finite required dimension', () => {
    const result = runFloorCheck(`    persona: .nan
    moguNote: 8
    vibe: 8
    narrative: 8
    score: 8`);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('persona');
  });

  it('rejects a non-finite explicit composite score', () => {
    const result = runFloorCheck(`    persona: 8
    moguNote: 8
    vibe: 8
    narrative: 8
    score: 1e999`);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('scores.vibe.score must be a finite number');
  });

  it('keeps the finite-dimension average fallback when score is absent', () => {
    const result = runFloorCheck(`    persona: 8
    moguNote: 8
    vibe: 8
    narrative: 8`);

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('scores.vibe composite 8 >= floor 3');
  });

  it('rejects an overflowing composite when score is absent', () => {
    const result = runFloorCheck(`    persona: 1e308
    moguNote: 1e308
    vibe: 1e308
    narrative: 1e308`);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('scores.vibe composite must be a finite number');
  });
});
