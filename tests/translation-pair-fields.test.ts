/**
 * 中英翻譯配對必須一致的欄位（validate-posts Rule 14，#1164）。
 * en-mp-169、en-mp-171 曾經少了中文版的 `series`，英文站的 SeriesNav 因此少算文章。
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { findPairFieldMismatches } from '../scripts/lib/translation-pair-fields.mjs';
import * as vModule from '../scripts/validate-posts.mjs';
import { getNeutralSummary } from '../src/lib/tombstone-copy.mjs';
import { useTestTempDirectories } from './helpers/temp-directories';

// validate-posts.mjs 是沒有 .d.ts 的純 JS。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { validatePost } = vModule as any;

const SERIES = { name: "Simon Willison's Agentic Engineering", order: 12 };
const SOURCE = 'https://x.com/simonw/status/2032885170542620884';
const PAIR_FILE = 'mp-169-20260315-simonw-pragmatic-summit-agentic-engineering.mdx';
const pair = (overrides: Record<string, unknown> = {}) => ({
  filename: PAIR_FILE,
  ticketId: 'MP-169',
  sourceUrl: SOURCE,
  series: SERIES,
  ...overrides,
});
const fm = (overrides: Record<string, unknown> = {}) => ({
  ticketId: 'MP-169',
  sourceUrl: SOURCE,
  series: SERIES,
  ...overrides,
});

describe('findPairFieldMismatches', () => {
  it('passes a pair that shares ticketId, series and sourceUrl', () => {
    expect(findPairFieldMismatches(fm(), pair())).toEqual([]);
    // validate-posts 把 YAML 數字轉成字串，兩邊型別不同也算同一個 order
    expect(findPairFieldMismatches(fm({ series: { ...SERIES, order: '12' } }), pair())).toEqual([]);
  });

  it('has nothing to compare without a pair', () => {
    expect(findPairFieldMismatches(fm(), null)).toEqual([]);
  });

  it('flags a series missing on one side', () => {
    expect(findPairFieldMismatches(fm({ series: undefined }), pair())).toEqual([
      `Translation pair ${PAIR_FILE} has a different series (${JSON.stringify(SERIES)} vs null)`,
    ]);
    expect(findPairFieldMismatches(fm(), pair({ series: undefined }))).toHaveLength(1);
  });

  it('flags a different series name or order', () => {
    for (const series of [
      { ...SERIES, order: 13 },
      { ...SERIES, name: 'Another series' },
    ]) {
      const errors = findPairFieldMismatches(fm({ series }), pair());
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('has a different series');
    }
  });

  it('flags a different external sourceUrl', () => {
    const errors = findPairFieldMismatches(
      fm({ sourceUrl: 'https://x.com/simonw/status/1' }),
      pair()
    );
    expect(errors).toEqual([
      `Translation pair ${PAIR_FILE} has a different sourceUrl (${JSON.stringify(SOURCE)} vs "https://x.com/simonw/status/1")`,
    ]);
  });

  it('skips originals whose sourceUrl points at their own gu-log URL', () => {
    const zh = 'https://gu-log.vercel.app/posts/lv-19-20261020-speculative-decoding';
    const en = 'https://gu-log.vercel.app/en/posts/en-lv-19-20261020-speculative-decoding';
    expect(
      findPairFieldMismatches(fm({ ticketId: 'Lv-19', sourceUrl: en, series: undefined }), {
        filename: 'lv-19-20261020-speculative-decoding.mdx',
        ticketId: 'Lv-19',
        sourceUrl: zh,
      })
    ).toEqual([]);
    // 只有一邊是外部來源還是要擋
    expect(findPairFieldMismatches(fm({ sourceUrl: en }), pair())).toHaveLength(1);
  });

  it('compares sourceUrl of a taken-down pair even without an external source', () => {
    // openspec post-takedown：下架配對不管來源類型，sourceUrl 都要一樣
    const takenDown = { status: 'taken-down' };
    const zh = 'https://chatgpt.com/share/zh';
    const en = 'https://chatgpt.com/share/en';
    expect(
      findPairFieldMismatches(
        fm({ ...takenDown, sourceUrl: en }),
        pair({ ...takenDown, sourceUrl: zh })
      )
    ).toEqual([
      `Translation pair ${PAIR_FILE} has a different sourceUrl (${JSON.stringify(zh)} vs ${JSON.stringify(en)})`,
    ]);
    // 只有一邊下架時，takedown 規則會先要求兩邊一起下架，這裡照一般規則不比
    expect(
      findPairFieldMismatches(fm({ sourceUrl: en }), pair({ ...takenDown, sourceUrl: zh }))
    ).toEqual([]);
  });

  it('keeps the ticketId mismatch message', () => {
    expect(findPairFieldMismatches(fm(), pair({ ticketId: 'MP-170' }))).toEqual([
      `Translation pair ticketId mismatch: this="MP-169", pair="MP-170" (${PAIR_FILE})`,
    ]);
  });
});

describe('validatePost — Rule 14 wiring', () => {
  const makeTempDirectory = useTestTempDirectories({ cleanup: 'afterAll' });
  const TMP = makeTempDirectory('gupair-');
  const write = (name: string, lines: string[], body = '') => {
    const filepath = path.join(TMP, path.basename(name));
    fs.writeFileSync(filepath, `---\n${lines.join('\n')}\n---\n${body}`);
    return filepath;
  };
  const errorsWith = (r: { errors: string[] }, text: string) =>
    r.errors.filter((e: string) => e.includes(text));

  it('flags an en post that lost the series its zh pair has', () => {
    const filepath = write(`en-${PAIR_FILE}`, [
      'ticketId: "MP-169"',
      `sourceUrl: "${SOURCE}"`,
      'lang: "en"',
    ]);
    const r = validatePost(filepath, [pair()]);
    expect(errorsWith(r, 'has a different series')).toHaveLength(1);
  });

  it('skips pair checks when the pair frontmatter could not be read', () => {
    // 配對檔 YAML 壞掉時，validate-posts 的預讀摘要只剩空值並標成 unreadable；
    // 壞檔自己會報 Invalid YAML，健康的這一邊不該再多出配對錯誤。
    const filepath = write(`en-${PAIR_FILE}`, [
      'ticketId: "MP-169"',
      `sourceUrl: "${SOURCE}"`,
      'lang: "en"',
    ]);
    const r = validatePost(filepath, [{ filename: PAIR_FILE, ticketId: '', unreadable: true }]);
    expect(errorsWith(r, 'Translation pair')).toEqual([]);
    // 同一份摘要沒標 unreadable 時，空值會被當成真的不一致
    const noisy = validatePost(filepath, [{ filename: PAIR_FILE, ticketId: '' }]);
    expect(errorsWith(noisy, 'has a different sourceUrl')).toHaveLength(1);
  });

  it('reports a taken-down pair with a different sourceUrl once', () => {
    const zhFile = 'gp-273-20260813-human-loop.mdx';
    const filepath = write(`en-${zhFile}`, [
      'ticketId: "GP-273"',
      'title: "The human is the loop, explained"',
      'sourceUrl: "https://brentfitzgerald.com/posts/the-human-is-the-loop/"',
      `summary: ${JSON.stringify(getNeutralSummary({ ticketId: 'GP-273', lang: 'en' }))}`,
      'lang: "en"',
      'status: "taken-down"',
      'takenDownAt: "2026-09-27"',
      'sourceTitle: "The human is the loop"',
    ]);
    const r = validatePost(filepath, [
      {
        filename: zhFile,
        ticketId: 'GP-273',
        status: 'taken-down',
        takenDownAt: '2026-09-27',
        sourceUrl: 'https://brentfitzgerald.com/posts/another/',
        sourceTitle: 'The human is the loop',
      },
    ]);
    expect(errorsWith(r, 'different sourceUrl')).toHaveLength(1);
  });
});
