import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as jj from '../scripts/check-jingjing.mjs';

describe('check-jingjing tokenizer', () => {
  it('keeps a versioned model ID with a hyphenated suffix as one token', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jj-tokenize-'));
    const filepath = path.join(dir, 'jj-model-id.mdx');
    fs.writeFileSync(
      filepath,
      `---\nlang: zh-tw\n---\n被抓的是 Qwen3.8-Flash-Next 跟 LFM2.5-1.2B-Thinking。\n`
    );
    expect(jj.checkFile(filepath).violations).toEqual([]);
  });
});
