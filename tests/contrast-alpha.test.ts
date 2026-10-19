import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(import.meta.dirname, '../scripts/check-contrast.mjs');

function checkDeclaration(declaration: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gu-log-contrast-alpha-'));
  const fixture = path.join(root, 'fixture.css');
  fs.writeFileSync(fixture, `.sample { ${declaration} }\n`);

  try {
    return spawnSync(process.execPath, [SCRIPT, fixture], {
      encoding: 'utf8',
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('contrast checker alpha colors', () => {
  it('keeps opaque hex colors compatible', () => {
    const result = checkDeclaration('color: #000000; /* black on #ffffff */');

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('color contrast pairs pass WCAG AA');
  });

  it('composites a translucent foreground before checking contrast', () => {
    const result = checkDeclaration('color: #00000080; /* translucent black on #ffffff */');

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('#00000080 on #ffffff');
    expect(result.stderr).toContain('4.00:1');
  });

  it('composites shorthand alpha colors before checking contrast', () => {
    const result = checkDeclaration('color: #0008; /* translucent black on #fff */');

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('#0008 on #fff');
    expect(result.stderr).toContain('4.48:1');
  });

  it('fails closed for a translucent background without an underlay', () => {
    const result = checkDeclaration('color: #000000; /* opaque black on #ffffff80 */');

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('background #ffffff80 must be opaque');
  });

  it('fails closed for a malformed annotated hex color', () => {
    const result = checkDeclaration('color: #12345; /* invalid color on #ffffff */');

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unsupported hex color #12345');
  });

  it('fails closed when the foreground hash contains non-hex characters', () => {
    const result = checkDeclaration('color: #ggg; /* invalid color on #ffffff */');

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unsupported hex color #ggg');
  });

  it('does not truncate a malformed background to a valid hex prefix', () => {
    const result = checkDeclaration('color: #000000; /* black on #fffggg */');

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unsupported hex color #fffggg');
  });

  it('decodes CSS escapes instead of skipping the annotated pair', () => {
    const result = checkDeclaration(String.raw`color: #\66 00; /* escaped red on #fff */`);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(String.raw`#\66 00 on #fff`);
    expect(result.stderr).toContain('4.00:1');
  });
});
