import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const globalCss = readFileSync(new URL('src/styles/global.css', root), 'utf8');

describe('iOS Dynamic Type', () => {
  it('GIVEN iOS WebKit with a user-selected text size WHEN global typography loads THEN the root uses Dynamic Type metrics', () => {
    const dynamicTypeRule = globalCss.match(
      /@supports\s*\(font:\s*-apple-system-body\)\s*\{\s*@media\s*\(hover:\s*none\)\s*\{\s*html\s*\{(?<declarations>[\s\S]*?)\}\s*\}\s*\}/
    );

    expect(dynamicTypeRule?.groups?.declarations).toContain('font: -apple-system-body;');
  });

  it('GIVEN a browser outside the iOS Dynamic Type gate WHEN global typography loads THEN the existing 16px baseline remains', () => {
    expect(globalCss).toMatch(/html\s*\{[^}]*font-size:\s*16px;/);
  });
});
