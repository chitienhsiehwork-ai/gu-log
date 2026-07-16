/**
 * Contract tests for scripts/frontmatter-scores.mjs (read/write tribunal
 * scores in MDX frontmatter).
 *
 * Pins the rebrand core contracts at the score-writer layer:
 *   - legacy read: a post with NO scores.tribunalVersion stamp is read with
 *     v8 dimension ownership (Vibe owns clarity), never the current version
 *   - new writes stamp the current tribunalVersion (9)
 *   - retired `clawdNote` input is explicitly rejected, never silently
 *     dropped on the floor while the write "succeeds"
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../scripts/frontmatter-scores.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gufms-'));

function makePost(name: string, fmExtra = ''): string {
  const p = path.join(TMP, name);
  fs.writeFileSync(
    p,
    `---\nticketId: GP-42\ntitle: Test\nlang: zh-tw\ntranslatedDate: 2026-07-01\n${fmExtra}---\n\nBody.\n`
  );
  return p;
}

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(args: string[]): RunResult {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      status: e.status ?? 1,
      stdout: String(e.stdout ?? ''),
      stderr: String(e.stderr ?? ''),
    };
  }
}

const V8_VIBE_FM = [
  'scores:',
  '  vibe:',
  '    persona: 8',
  '    moguNote: 8',
  '    vibe: 8',
  '    clarity: 7',
  '    narrative: 8',
  '    score: 7',
  '    date: "2026-03-01"',
  '',
].join('\n');

describe('frontmatter-scores get — legacy version default', () => {
  it('reads an unstamped legacy post with v8 ownership (Vibe clarity surfaces)', () => {
    const post = makePost('gp-42-legacy.mdx', V8_VIBE_FM);
    const r = run(['get', post, 'vibe']);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    // Missing tribunalVersion = legacy v8 read: clarity belongs to Vibe and
    // MUST be returned. Defaulting to the current version (9) would silently
    // drop the clarity dimension from every pre-stamp post.
    expect(parsed.dimensions.clarity).toBe(7);
    expect(parsed.dimensions).toMatchObject({
      persona: 8,
      moguNote: 8,
      vibe: 8,
      clarity: 7,
      narrative: 8,
    });
  });
});

describe('frontmatter-scores write — version stamping', () => {
  it('stamps tribunalVersion 9 on a new vibe write and omits clarity from dims', () => {
    const post = makePost('gp-42-new.mdx');
    const scoreJson = JSON.stringify({
      judge: 'vibe',
      dimensions: { persona: 9, moguNote: 8, vibe: 8, narrative: 8 },
      score: 8,
      verdict: 'PASS',
      model: 'gpt-5.5',
    });
    const r = run(['write', post, 'vibe', scoreJson]);
    expect(r.status).toBe(0);
    const content = fs.readFileSync(post, 'utf8');
    expect(content).toMatch(/tribunalVersion: 9/);
    expect(content).toMatch(/moguNote: 8/);
    expect(content).not.toMatch(/clarity:/);
  });
});

describe('frontmatter-scores write — retired clawdNote input', () => {
  it('rejects a vibe write whose dimensions carry clawdNote', () => {
    const post = makePost('gp-42-retired.mdx');
    const scoreJson = JSON.stringify({
      judge: 'vibe',
      dimensions: { persona: 9, clawdNote: 8, vibe: 8, narrative: 8 },
      score: 8,
      verdict: 'PASS',
    });
    const r = run(['write', post, 'vibe', scoreJson]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/moguNote/);
    // The file must be untouched — no partial write, no silently-dropped key.
    const content = fs.readFileSync(post, 'utf8');
    expect(content).not.toMatch(/scores:/);
  });

  it('rejects a flat-format write carrying clawdNote', () => {
    const post = makePost('gp-42-retired-flat.mdx');
    const scoreJson = JSON.stringify({
      judge: 'vibe',
      persona: 9,
      clawdNote: 8,
      vibe: 8,
      narrative: 8,
      score: 8,
    });
    const r = run(['write', post, 'vibe', scoreJson]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/moguNote/);
  });
});
