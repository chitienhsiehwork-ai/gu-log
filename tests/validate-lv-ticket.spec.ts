import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Tests for validate-posts.mjs accepting Lv-XX ticket format
 */

const projectRoot = path.resolve(import.meta.dirname, '..');
const postsDir = path.join(projectRoot, 'src/content/posts');

test.describe('Validator Lv-XX ticket format', () => {
  const tempFile = path.join(postsDir, '_test-lv-validator-20260101.mdx');

  test.afterEach(() => {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  });

  test('GIVEN a post with Lv-1 ticketId WHEN validated THEN passes', () => {
    const filler = '這是測試用的內容。'.repeat(30);
    const content = `---
ticketId: 'Lv-1'
title: 'Test Level Up Post'
originalDate: '2026-01-01'
source: 'ShroomDog'
sourceUrl: 'https://gu-log.dev'
summary: 'A test level-up post for validator testing'
lang: 'zh-tw'
tags: ['test']
---

${filler}
`;
    fs.writeFileSync(tempFile, content, 'utf-8');

    const result = execSync(
      `node scripts/validate-posts.mjs "${tempFile}"`,
      { cwd: projectRoot, encoding: 'utf-8' }
    );
    expect(result).toContain('PASSED');
  });

  test('GIVEN a post with Lv-99 ticketId WHEN validated THEN passes', () => {
    const filler = '這是測試用的內容。'.repeat(30);
    const content = `---
ticketId: 'Lv-98'
title: 'Test Level Up Post 98'
originalDate: '2026-01-01'
source: 'ShroomDog'
sourceUrl: 'https://gu-log.dev'
summary: 'A test level-up post for validator testing'
lang: 'zh-tw'
tags: ['test']
---

${filler}
`;
    fs.writeFileSync(tempFile, content, 'utf-8');

    const result = execSync(
      `node scripts/validate-posts.mjs "${tempFile}"`,
      { cwd: projectRoot, encoding: 'utf-8' }
    );
    expect(result).toContain('PASSED');
  });

  test('GIVEN a post with LV-1 (wrong case) ticketId WHEN validated THEN fails', () => {
    const filler = '這是測試用的內容。'.repeat(30);
    const content = `---
ticketId: 'LV-1'
title: 'Test Wrong Case'
originalDate: '2026-01-01'
source: 'ShroomDog'
sourceUrl: 'https://gu-log.dev'
summary: 'Testing wrong ticket case'
lang: 'zh-tw'
tags: ['test']
---

${filler}
`;
    fs.writeFileSync(tempFile, content, 'utf-8');

    try {
      execSync(
        `node scripts/validate-posts.mjs "${tempFile}"`,
        { cwd: projectRoot, encoding: 'utf-8' }
      );
      // Should not reach here
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.stdout || e.stderr).toContain('Invalid ticketId format');
    }
  });
});
