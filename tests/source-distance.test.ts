/**
 * 來源距離章（openspec source-distance-stamp）的確定性邏輯：投影、斷句、計分、
 * 英文逐字檢查與章。所有原文、導讀與配對都是自寫的合成資料，不呼叫模型。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  POLICY,
  isExternalSource,
  requiresStamp,
  segmentGuide,
  segmentSource,
  sourceSummary,
  splitSentences,
  subjectFingerprint,
  units,
} from '../scripts/lib/source-distance.mjs';

const FIXTURES = path.join(__dirname, 'fixtures/source-distance');
const GUIDE = fs.readFileSync(path.join(FIXTURES, 'guide.mdx'), 'utf8');
const CAPTURE = fs.readFileSync(path.join(FIXTURES, 'capture.txt'), 'utf8');
const SOURCE_URL = 'https://keeper-notes.test/posts/logbook-on-call';
const MP12 = 'mp-12-20260101-pager-basics';
const POST_INDEX = new Map([[MP12, { ticketId: 'MP-12', title: '告警疲勞是設計問題' }]]);

function fingerprintOf(content: string, url = SOURCE_URL) {
  return subjectFingerprint(url, segmentGuide(content, { postIndex: POST_INDEX }));
}

describe('units 與斷句', () => {
  it('units 算 CJK 字數加拉丁詞數，數字算一個詞', () => {
    expect(units('Claude 4.7 很強')).toBe(4);
    expect(units('1,000 users')).toBe(2);
    expect(units('(｀・ω・´)')).toBe(0);
  });

  it('中文句末標點都會斷句', () => {
    expect(splitSentences('第一句。第二句！第三句？第四句；最後一句')).toEqual([
      '第一句。',
      '第二句！',
      '第三句？',
      '第四句；',
      '最後一句',
    ]);
  });

  it('斷句避開英文縮寫、人名縮寫與單位縮寫', () => {
    expect(splitSentences('Use e.g. this one. Mr. Smith left. The U.S. Navy agreed.')).toEqual([
      'Use e.g. this one.',
      'Mr. Smith left.',
      'The U.S. Navy agreed.',
    ]);
    expect(splitSentences('J. K. Rowling wrote it. Then')).toEqual([
      'J. K. Rowling wrote it.',
      'Then',
    ]);
  });

  it('斷句避開小數、版本號與網址', () => {
    expect(
      splitSentences('Pi is 3.14 today. Version 4.7 shipped. See https://docs.test/a.b now. Done.')
    ).toEqual([
      'Pi is 3.14 today.',
      'Version 4.7 shipped.',
      'See https://docs.test/a.b now.',
      'Done.',
    ]);
  });

  it('收尾引號併進同一句，純顏文字併進前一句', () => {
    expect(splitSentences('He said "stop." Then we left. (◕‿◕)')).toEqual([
      'He said "stop."',
      'Then we left. (◕‿◕)',
    ]);
  });
});

describe('正文投影', () => {
  const guide = segmentGuide(GUIDE, { postIndex: POST_INDEX });
  const texts = guide.map((s) => s.text);
  const joined = texts.join('\n');

  it('標題、清單、表格列、引言與元件依區塊斷句', () => {
    expect(guide[0]).toMatchObject({ id: 'C1', kind: 'heading', text: '為什麼這篇值得讀' });
    expect(guide.filter((s) => s.kind === 'table-row').map((s) => s.text)).toEqual([
      '做法 | Mogu 的看法',
      '固定格式 | 半夜三點不用想措辭',
      '沉默規則 | 最便宜的告警',
    ]);
    expect(guide.find((s) => s.kind === 'quote')?.text).toBe(
      '原作者引用老站長的話：沉默規則救的船比燈還多。'
    );
  });

  it('MoguNote 與 ShroomDogNote 都算正文', () => {
    expect(joined).toContain('Mogu 覺得這跟打團前先看小地圖很像');
    expect(joined).toContain('我們團隊也試過每班結束寫一行');
  });

  it('排除 frontmatter、import、圖片、程式碼與機器插入的區塊', () => {
    expect(joined).not.toMatch(/ticketId|import |lighthouse\.png|pager handoff/);
    expect(joined).not.toContain('延伸閱讀');
    expect(joined).not.toContain('確認失效');
  });

  it('連結只取文字；ticket／標題型站內連結整段不進投影', () => {
    expect(joined).not.toMatch(/https?:|\/posts\/|\/glossary/);
    expect(joined).toContain('外部參考可以看 NOAA 的燈塔資料，名詞可以查 交接。');
    expect(joined).toContain('之前 講過告警疲勞， 也可以一起看。');
    expect(joined).not.toContain('MP-12');
  });

  it('包成站內連結的轉述照樣進投影，改連結文字會讓指紋改變', () => {
    expect(joined).toContain('燈塔守則其實是在講交接');
    const edited = GUIDE.replace('[燈塔守則其實是在講交接]', '[燈塔守則其實在講值班交接]');
    expect(fingerprintOf(edited)).not.toBe(fingerprintOf(GUIDE));
  });

  it('以 CJK 為主的 fenced code 算文字，其餘 code 不進投影', () => {
    expect(guide.find((s) => s.kind === 'code-text')?.text).toBe('交接格式：時間、訊號、處置。');
  });

  it('投影指紋固定', () => {
    expect(subjectFingerprint(SOURCE_URL, guide)).toBe(
      'af2140e4c44d031973faa2aa59178b6a6c1216cd1706137603ac1e9bee561fbf'
    );
  });
});

describe('原文正規化', () => {
  const source = segmentSource(CAPTURE);
  const joined = source.map((s) => s.text).join('\n');

  it('去掉擷取標頭、導覽、日期、作者列、分享鈕、相關文章與作者簡介', () => {
    expect(source[0].text).toBe(
      'The lighthouse logbook was the first on-call runbook I ever trusted.'
    );
    expect(joined).not.toMatch(
      /Source URL|Fetched|Archive|August 30|Mara Quill|6 min read|^Share$/m
    );
    expect(joined).not.toMatch(/Related posts|Pager fatigue|About the author|maritime habits/);
    expect(joined).toContain('It takes two minutes and catches stale assumptions.');
  });

  it('同一份擷取每次正規化的結果與 units 都相同', () => {
    const again = segmentSource(CAPTURE);
    expect(again).toEqual(source);
    expect(sourceSummary(again)).toEqual(sourceSummary(source));
    expect(sourceSummary(source).sourceUnits).toBe(215);
  });

  it('整份都是短行時不剪開頭', () => {
    expect(segmentSource('gm\nshipping today').map((s) => s.text)).toEqual([
      'gm',
      'shipping today',
    ]);
  });

  it('以 CJK 為主的原文用同語言的 κ', () => {
    const zh = segmentSource('這是一段中文原文，講燈塔的值班日誌。每一班都要寫一行。');
    expect(sourceSummary(zh).kappa).toBe(POLICY.kappaCjk);
    expect(sourceSummary(source).kappa).toBe(POLICY.kappa);
  });
});

describe('外部來源與需要章的文章', () => {
  it.each([
    ['https://keeper-notes.test/posts/a', true],
    ['https://example.com/original-article', false],
    ['https://docs.example.org/x', false],
    ['https://gu-log.vercel.app/posts/mp-1', false],
    ['/posts/mp-1', false],
    ['https://chatgpt.com/share/abc', false],
    ['https://chatgpt.com/c/abc', true],
    ['', false],
  ])('%s → %s', (url, expected) => {
    expect(isExternalSource(url)).toBe(expected);
  });

  it('只有有外部來源、沒下架的 GP 需要章', () => {
    const gp = { ticketId: 'GP-PENDING', sourceUrl: SOURCE_URL };
    expect(requiresStamp(gp)).toBe(true);
    expect(requiresStamp({ ...gp, ticketId: 'GP-12' })).toBe(true);
    expect(requiresStamp({ ...gp, ticketId: 'MP-12' })).toBe(false);
    expect(requiresStamp({ ...gp, status: 'taken-down' })).toBe(false);
    expect(requiresStamp({ ...gp, sourceUrl: 'https://example.com/original-article' })).toBe(false);
  });
});
