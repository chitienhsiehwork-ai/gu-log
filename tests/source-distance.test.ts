/**
 * 來源距離章（openspec source-distance-stamp）的確定性邏輯：投影、斷句、計分、
 * 英文逐字檢查與章。所有原文、導讀與配對都是自寫的合成資料，不呼叫模型。
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  POLICY,
  decide,
  englishVerbatim,
  isExternalSource,
  parseFrontmatter,
  requiresStamp,
  rewriteReport,
  scoreAlignment,
  segmentGuide,
  segmentSource,
  serializeStamp,
  sourceSummary,
  splitSentences,
  subjectFingerprint,
  units,
  validateAlignment,
  verifyStamp,
  writeStamp,
} from '../scripts/lib/source-distance.mjs';
import { useTestTempDirectories } from './helpers/temp-directories';

const makeTempDirectory = useTestTempDirectories({ cleanup: 'afterAll' });

const FIXTURES = path.join(__dirname, 'fixtures/source-distance');
const GUIDE = fs.readFileSync(path.join(FIXTURES, 'guide.mdx'), 'utf8');
const CAPTURE = fs.readFileSync(path.join(FIXTURES, 'capture.txt'), 'utf8');
const SOURCE_URL = 'https://keeper-notes.test/posts/logbook-on-call';
const MP12 = 'mp-12-20260101-pager-basics';

function fingerprintOf(content: string, url = SOURCE_URL) {
  return subjectFingerprint(url, segmentGuide(content));
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
  const guide = segmentGuide(GUIDE);
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

  it('連結只取文字；只有文字剛好是 ticket 編號的站內連結不進投影', () => {
    expect(joined).not.toMatch(/https?:|\/posts\/|\/glossary/);
    expect(joined).toContain('外部參考可以看 NOAA 的燈塔資料，名詞可以查 交接。');
    expect(joined).toContain('之前 講過告警疲勞，MP-12: 告警疲勞是設計問題 也可以一起看。');
  });

  it('包成站內連結的轉述照樣進投影，連結文字不只是 ticket 時改字會讓指紋改變', () => {
    expect(joined).toContain('燈塔守則其實是在講交接');
    for (const [from, to] of [
      ['[燈塔守則其實是在講交接]', '[燈塔守則其實在講值班交接]'],
      ['[MP-12: 告警疲勞是設計問題]', '[MP-12: 告警疲勞其實是設計問題]'],
    ]) {
      expect(fingerprintOf(GUIDE.replace(from, to))).not.toBe(fingerprintOf(GUIDE));
    }
  });

  it('以 CJK 為主的 fenced code 算文字，其餘 code 不進投影', () => {
    expect(guide.find((s) => s.kind === 'code-text')?.text).toBe('交接格式：時間、訊號、處置。');
  });

  it('投影指紋固定', () => {
    expect(subjectFingerprint(SOURCE_URL, guide)).toBe(
      '5657191342e9e1adecd22a9fb0572c6e0a064f844b1111b47ba8d34e6fd21a72'
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

type Sentence = { id: string; text: string; units: number; block: number };

/** 合成的斷句：每句給定 units，每句自成一個區塊。 */
function synthetic(prefix: string, unitList: number[], text = (i: number) => `${prefix}${i}`) {
  return unitList.map((u, i) => ({
    id: `${prefix}${i + 1}`,
    text: text(i + 1),
    units: u,
    block: i + 1,
  })) as Sentence[];
}

function alignment(entries: Record<string, string[]>, guide: Sentence[]) {
  return new Map(guide.map((c) => [c.id, entries[c.id] || []]));
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `S${from + i}`);

describe('配對驗證', () => {
  const guide = synthetic('C', [16, 16]);
  const source = synthetic('S', [10, 10]);

  it('合格的配對轉成 Map，重複的原文編號去重', () => {
    const map = validateAlignment(
      {
        alignments: [
          { c: 'C1', s: ['S1', 'S1'] },
          { c: 'C2', s: [] },
        ],
      },
      guide,
      source
    );
    expect(map.get('C1')).toEqual(['S1']);
    expect(map.get('C2')).toEqual([]);
  });

  it.each([
    ['漏句', { alignments: [{ c: 'C1', s: ['S1'] }] }, /missing guide sentence/],
    [
      '重複列出導讀句',
      {
        alignments: [
          { c: 'C1', s: [] },
          { c: 'C1', s: [] },
          { c: 'C2', s: [] },
        ],
      },
      /twice/,
    ],
    ['不存在的導讀句', { alignments: [{ c: 'C9', s: [] }] }, /unknown guide sentence/],
    [
      '不存在的原文句',
      {
        alignments: [
          { c: 'C1', s: ['S7'] },
          { c: 'C2', s: [] },
        ],
      },
      /unknown source sentence S7/,
    ],
    ['沒有 alignments', { result: [] }, /no "alignments"/],
  ])('%s讓這次配對失敗', (_name, raw, message) => {
    expect(() => validateAlignment(raw, guide, source)).toThrow(message);
  });
});

describe('擋下條件由程式依固定參數計算', () => {
  // κ 1.6：16 units 的導讀句等效長度 10，剛好等於一句 10 units 的原文。
  const source30 = synthetic('S', Array(30).fill(10));

  it('連續三句照順序翻譯：規則①不通過', () => {
    const guide = synthetic('C', [16, 16, 16]);
    const map = alignment({ C1: ['S1'], C2: ['S2'], C3: ['S3'] }, guide);
    expect(scoreAlignment(guide, source30, map).maxRun).toBe(3);
    expect(decide(guide, source30, [map])).toMatchObject({ verdict: 'FAIL', fails: ['run'] });
  });

  it('三句併一句照翻算翻譯型配對，不會被當成摘要', () => {
    const guide = synthetic('C', [48, 48, 48]);
    const map = alignment({ C1: range(1, 3), C2: range(4, 6), C3: range(7, 9) }, guide);
    const score = scoreAlignment(guide, source30, map);
    expect(score.pairs.every((p: { translation: boolean }) => p.translation)).toBe(true);
    expect(score.maxRun).toBe(3);
  });

  it('翻兩句夾一句吐槽：評論與摘要都不切斷連續段', () => {
    const guide = synthetic('C', [16, 16, 20, 16]);
    const commentary = alignment({ C1: ['S1'], C2: ['S2'], C4: ['S3'] }, guide);
    expect(scoreAlignment(guide, source30, commentary).maxRun).toBe(3);

    const summary = synthetic('C', [16, 16, 2, 16]);
    const withSummary = alignment(
      { C1: ['S1'], C2: ['S2'], C3: range(10, 20), C4: ['S3'] },
      summary
    );
    const score = scoreAlignment(summary, source30, withSummary);
    expect(score.pairs.find((p: { c: string }) => p.c === 'C3')!.translation).toBe(false);
    expect(score.maxRun).toBe(3);
  });

  it('一句總覽只算它自身等效長度的原文量', () => {
    const guide = synthetic('C', [8]);
    const score = scoreAlignment(guide, source30, alignment({ C1: range(1, 30) }, guide));
    expect(score.pairs[0].translation).toBe(false);
    expect(score.sourceRatio).toBeCloseTo(5 / 300, 10);
  });

  it('重講的原文超過三成：規則②不通過', () => {
    const guide = synthetic('C', Array(10).fill(16));
    const entries = Object.fromEntries(guide.map((c, i) => [c.id, [`S${1 + 3 * i}`]]));
    const map = alignment(entries, guide);
    const score = scoreAlignment(guide, source30, map);
    expect(score.maxRun).toBe(1);
    expect(score.sourceRatio).toBeCloseTo(100 / 300, 10);
    expect(decide(guide, source30, [map])).toMatchObject({ verdict: 'FAIL', fails: ['ratio'] });
  });

  it('第一次配對沒有任何配對：零配對', () => {
    const guide = synthetic('C', [16, 16]);
    expect(decide(guide, source30, [alignment({}, guide)])).toMatchObject({
      verdict: 'ZERO',
      fails: ['zero'],
    });
  });

  it('第一次三條都過才做第二次；第二次規則①沒過就不通過', () => {
    const guide = synthetic('C', [16, 16, 16]);
    const first = alignment({ C1: ['S1'], C2: ['S5'], C3: ['S9'] }, guide);
    expect(decide(guide, source30, [first])).toMatchObject({ verdict: 'NEEDS_SECOND' });

    const second = alignment({ C1: ['S1'], C2: ['S2'], C3: ['S3'] }, guide);
    expect(decide(guide, source30, [first, second])).toMatchObject({
      verdict: 'FAIL',
      fails: ['run'],
    });

    const pass = decide(guide, source30, [first, first]);
    expect(pass).toMatchObject({
      verdict: 'PASS',
      metrics: { maxRun: 1, sourceRatio: 0.1, alignedSentences: 3 },
    });
  });

  it('規則②用兩次配對的聯集計算', () => {
    // 兩次配對各自只配到一半的導讀句（各重講 60/300），聯集後是 120/300。
    const guide = synthetic('C', Array(12).fill(16));
    const firstHalf = Object.fromEntries(
      guide.slice(0, 6).map((c, i) => [c.id, [`S${1 + 4 * i}`]])
    );
    const secondHalf = Object.fromEntries(guide.slice(6).map((c, i) => [c.id, [`S${3 + 4 * i}`]]));
    const first = alignment(firstHalf, guide);
    const second = alignment(secondHalf, guide);
    const result = decide(guide, source30, [first, second]);
    expect(result.scores.map((s: { sourceRatio: number }) => s.sourceRatio)).toEqual([0.2, 0.2]);
    expect(result).toMatchObject({ verdict: 'FAIL', fails: ['ratio'] });
    expect(result.metrics!.sourceRatio).toBeCloseTo(0.4, 10);
  });

  it('一句對到 S4＋S103 時先依相鄰關係分群，進度不會直接跳到尾', () => {
    const source = synthetic('S', Array(110).fill(10));
    const guide = synthetic('C', [32, 16, 16]);
    const map = alignment({ C1: ['S4', 'S103'], C2: ['S5'], C3: ['S6'] }, guide);
    expect(scoreAlignment(guide, source, map).maxRun).toBe(3);
  });

  it('被切碎成三句的短引文不會湊出假的連續段', () => {
    const source = synthetic('S', [2, 4, 3, ...Array(20).fill(10)]);
    const guide = synthetic('C', [4, 7, 5]);
    const map = alignment({ C1: ['S1'], C2: ['S2'], C3: ['S3'] }, guide);
    const score = scoreAlignment(guide, source, map);
    expect(score.translationPairs).toBe(3);
    expect(score.maxRun).toBe(0);
  });

  it('改寫報告只列段落，不含任何數字、門檻或規則名稱', () => {
    const texts = [
      '燈塔日誌的第一句照翻',
      '第二句也照原文順序',
      '第三句繼續照翻',
      '這段是我們自己的評論',
    ];
    const guide = synthetic('C', [16, 16, 16, 16], (i) => texts[i - 1]);
    const map = alignment({ C1: ['S1'], C2: ['S2'], C3: ['S3'] }, guide);
    const result = decide(guide, source30, [map]);
    expect(result.verdict).toBe('FAIL');
    const report = result.report as string;
    for (const text of texts.slice(0, 3)) expect(report).toContain(text);
    expect(report).not.toMatch(/\d/);
    for (const word of ['門檻', '占比', '規則', '指標', 'β', 'κ', 'maxRun', 'ratio', '%']) {
      expect(report).not.toContain(word);
    }
    expect(rewriteReport(guide, source30, [map], [scoreAlignment(guide, source30, map)])).toBe(
      report
    );
  });
});

describe('英文版的逐字 n-gram 檢查', () => {
  const source = segmentSource(CAPTURE);
  const english = (body: string) =>
    [
      '---',
      "ticketId: 'GP-PENDING'",
      "lang: 'en'",
      `sourceUrl: '${SOURCE_URL}'`,
      '---',
      '',
      body,
    ].join('\n');
  const own =
    'Mara Quill turns an old maritime habit into an on-call rule, and the part worth stealing is small. ' +
    'Write one line even when nothing happens, because a missing line becomes the alarm.';

  it('沒標成引文的 40 詞照抄不通過', () => {
    const copied =
      'The first change was a fixed format: time, signal, action. People stopped writing essays at three in the morning. ' +
      'The second change was a rule about silence. If a shift leaves no handoff, the next person pages the previous one before doing anything else.';
    const result = englishVerbatim(english(`${own}\n\n${copied}`), source);
    expect(result.metrics.maxVerbatimWords).toBeGreaterThanOrEqual(40);
    expect(result.verdict).toBe('FAIL');
  });

  it('上限內的 blockquote 與引號引文不會讓檢查不通過', () => {
    const body = `${own}\n\n> Nobody wrote long entries.\n\nShe calls it "the silence rule" and means it.`;
    const result = englishVerbatim(english(body), source);
    expect(result.verdict).toBe('PASS');
    expect(result.metrics.quotedWords).toBe(7);
  });

  it('超過上限的引文照常計入逐字比對', () => {
    const quote =
      'The first change was a fixed format: time, signal, action. People stopped writing essays at three in the morning. The second change was a rule about silence.';
    const result = englishVerbatim(english(`${own}\n\n> ${quote}`), source);
    const allowance = Math.floor(POLICY.ngram.quoteAllowanceRatio * 215);
    expect(result.metrics.quotedWords).toBe(allowance);
    expect(result.verdict).toBe('FAIL');
  });

  it('原文是中文時英文版自然通過', () => {
    const zh = segmentSource('燈塔看守人每晚都在日誌寫一行。沒事也要寫，少了一行就代表出事。');
    const result = englishVerbatim(english(own), zh);
    expect(result.metrics.ngramContainment).toBe(0);
    expect(result.verdict).toBe('PASS');
  });
});

describe('章的序列化與驗證', () => {
  const guide = segmentGuide(GUIDE);
  const stamp = {
    policy: POLICY.version,
    verdict: 'PASS',
    subjectSha256: subjectFingerprint(SOURCE_URL, guide),
    sourceSha256: sourceSummary(segmentSource(CAPTURE)).sourceSha256,
    sourceUnits: 215,
    metrics: { maxRun: 2, sourceRatio: 0.22, alignedSentences: 9 },
    aligner: 'claude-sonnet-5',
    rewrites: 1,
    alignerCalls: 3,
    checkedAt: '2026-09-28',
  };
  const stamped = writeStamp(GUIDE, stamp);
  const check = (content: string) =>
    verifyStamp({
      content,
      data: parseFrontmatter(content),
      file: 'src/content/posts/gp-pending-20260928-logbook.mdx',
    });

  it('寫入後重讀驗證通過，正文與其他欄位一字不動', () => {
    expect(check(stamped)).toEqual({ required: true, errors: [] });
    expect(writeStamp(stamped, null)).toBe(GUIDE);
    expect(stamped.split('\n---\n')[1]).toBe(GUIDE.split('\n---\n')[1]);
    expect(writeStamp(stamped, stamp)).toBe(stamped);
  });

  it('章只存摘要，不存配對明細', () => {
    const data = parseFrontmatter(stamped);
    expect(Object.keys(data.sourceDistance).sort()).toEqual(
      [
        'aligner',
        'alignerCalls',
        'checkedAt',
        'metrics',
        'policy',
        'rewrites',
        'sourceSha256',
        'sourceUnits',
        'subjectSha256',
        'verdict',
      ].sort()
    );
    expect(serializeStamp(stamp)).not.toMatch(/alignments|pairs|S\d+|C\d+/);
  });

  it('GP 缺章：失敗並指出蓋章指令', () => {
    const result = check(GUIDE);
    expect(result.required).toBe(true);
    expect(result.errors.join('\n')).toContain(
      'tools/gp-pipeline/gp-pipeline stamp --file src/content/posts/gp-pending-20260928-logbook.mdx'
    );
  });

  it('改正文一個字，章就過期', () => {
    const edited = stamped.replace('真正的主角是值班交接', '真正的主角是值班的交接');
    expect(check(edited).errors.join('\n')).toMatch(/stale/);
  });

  it('改 sourceUrl，章就過期', () => {
    const edited = stamped.replace(`sourceUrl: '${SOURCE_URL}'`, `sourceUrl: '${SOURCE_URL}/'`);
    expect(check(edited).errors.join('\n')).toMatch(/stale/);
  });

  it('只改 ticket 編號型站內連結、連結網址、機器插入區塊或其他 frontmatter，章仍有效', () => {
    const edits = [
      stamped.replace(
        `[MP-12](/posts/${MP12}/)`,
        '[MP-13](https://gu-log.vercel.app/en/posts/mp-13-20260102-other/)'
      ),
      stamped.replace('https://www.noaa.test/lighthouses', 'https://lights.noaa.test/list'),
      stamped.replace(
        `[燈塔守則其實是在講交接](/posts/${MP12}/)`,
        '[燈塔守則其實是在講交接](/posts/mp-99-20260101-other/)'
      ),
      stamped.replace(
        '(/glossary#handoff)',
        '(/glossary#shift-handoff) [⚠️ 此連結已於 2026-09-20 確認失效]'
      ),
      stamped.replace("tags: ['operations']", "tags: ['operations', 'on-call']"),
      // inject-related-posts 的格式；清單只看形狀，不查目標文存不存在、標題對不對。
      `${stamped}\n## 延伸閱讀\n\n- [MP-12: 告警疲勞是設計問題](/posts/${MP12}/)\n- [GP-999: 沒有這篇](/posts/gp-999-20260101-missing/)\n`,
    ];
    for (const edited of edits) {
      expect(edited).not.toBe(stamped);
      expect(check(edited)).toEqual({ required: true, errors: [] });
    }
  });

  it('加上或清掉 englishSkipped 不影響指紋', () => {
    const skipped = writeStamp(stamped, { ...stamp, englishSkipped: 'verbatim' });
    expect(parseFrontmatter(skipped).sourceDistance.englishSkipped).toBe('verbatim');
    expect(check(skipped)).toEqual({ required: true, errors: [] });
    const bogus = writeStamp(stamped, { ...stamp, englishSkipped: 'other' });
    expect(check(bogus).errors.join('\n')).toMatch(/englishSkipped/);
  });

  it.each([
    ['policy 版本不符', { policy: 'source-distance/v0' }, /current policy/],
    ['verdict 不是 PASS', { verdict: 'FAIL' }, /verdict must be PASS/],
    ['連續段超過門檻', { metrics: { ...stamp.metrics, maxRun: 3 } }, /exceed/],
    ['占比超過門檻', { metrics: { ...stamp.metrics, sourceRatio: 0.31 } }, /exceed/],
    ['零配對', { metrics: { ...stamp.metrics, alignedSentences: 0 } }, /exceed/],
    ['少了呼叫次數', { alignerCalls: 1 }, /alignerCalls/],
  ])('%s：驗證失敗', (_name, override, message) => {
    const content = writeStamp(GUIDE, { ...stamp, ...override });
    expect(check(content).errors.join('\n')).toMatch(message);
  });

  it('英文章驗逐字檢查的指標，而且不帶 aligner 欄位', () => {
    const english = GUIDE.replace("lang: 'zh-tw'", "lang: 'en'");
    const base = {
      policy: POLICY.version,
      verdict: 'PASS',
      subjectSha256: stamp.subjectSha256,
      sourceSha256: stamp.sourceSha256,
      sourceUnits: 215,
      metrics: { ngramContainment: 0.02, maxVerbatimWords: 9, quotedWords: 7 },
      checkedAt: '2026-09-28',
    };
    expect(check(writeStamp(english, base)).errors).toEqual([]);
    const tooClose = { ...base, metrics: { ...base.metrics, maxVerbatimWords: 30 } };
    expect(check(writeStamp(english, tooClose)).errors.join('\n')).toMatch(/exceed/);
    expect(check(writeStamp(english, { ...base, aligner: 'x' })).errors.join('\n')).toMatch(
      /does not belong/
    );
  });

  it('不需要章的文章：GP-1 這類示範來源、下架文章與非 GP 都不要求；非 GP 帶章失敗', () => {
    const demo = GUIDE.replace(
      `sourceUrl: '${SOURCE_URL}'`,
      "sourceUrl: 'https://example.com/original-article'"
    );
    expect(check(demo)).toEqual({ required: false, errors: [] });
    const mp = GUIDE.replace("ticketId: 'GP-PENDING'", "ticketId: 'MP-PENDING'");
    expect(check(mp)).toEqual({ required: false, errors: [] });
    expect(check(writeStamp(mp, stamp)).errors.join('\n')).toMatch(/only allowed on GP/);
    const takenDown = GUIDE.replace("lang: 'zh-tw'", "lang: 'zh-tw'\nstatus: 'taken-down'");
    expect(check(takenDown)).toEqual({ required: false, errors: [] });
  });
});

describe('scripts/source-distance.mjs CLI', () => {
  const CLI = path.join(__dirname, '../scripts/source-distance.mjs');
  const run = (args: string[]) => {
    try {
      const out = execFileSync(process.execPath, [CLI, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { code: 0, out };
    } catch (error) {
      const failure = error as { status: number; stdout: string; stderr: string };
      return { code: failure.status, out: failure.stdout, err: failure.stderr };
    }
  };

  it('segment → score（兩次）→ stamp → verify 走完一輪，配對不合格時 exit 2', () => {
    const dir = makeTempDirectory('source-distance-cli-');
    const file = path.join(dir, 'final.mdx');
    fs.writeFileSync(file, GUIDE);
    const capture = path.join(FIXTURES, 'capture.txt');

    const segmented = run(['segment', '--file', file, '--source', capture]);
    expect(segmented.code).toBe(0);
    const segments = JSON.parse(segmented.out);
    expect(segments.subjectSha256).toBe(fingerprintOf(GUIDE));
    expect(segments.prompt.guide.split('\n')[0]).toBe('C1\t為什麼這篇值得讀');
    const segFile = path.join(dir, 'segments.json');
    fs.writeFileSync(segFile, segmented.out);

    const align = path.join(dir, 'align.json');
    fs.writeFileSync(
      align,
      JSON.stringify({
        alignments: segments.guide.map((c: Sentence) => ({
          c: c.id,
          s: c.id === 'C3' ? ['S4'] : c.id === 'C7' ? ['S9'] : [],
        })),
      })
    );
    const first = JSON.parse(run(['score', '--segments', segFile, '--alignment', align]).out);
    expect(first.verdict).toBe('NEEDS_SECOND');
    const scored = run([
      'score',
      '--segments',
      segFile,
      '--alignment',
      align,
      '--alignment',
      align,
    ]);
    const resultFile = path.join(dir, 'result.json');
    fs.writeFileSync(resultFile, scored.out);
    expect(JSON.parse(scored.out)).toMatchObject({
      verdict: 'PASS',
      metrics: { alignedSentences: 2 },
    });

    const stampArgs = [
      'stamp',
      '--file',
      file,
      '--result',
      resultFile,
      '--aligner',
      'claude-sonnet-5',
    ];
    const stampedRun = run([
      ...stampArgs,
      '--rewrites',
      '0',
      '--aligner-calls',
      '2',
      '--checked-at',
      '2026-09-28',
    ]);
    expect(stampedRun.code).toBe(0);
    expect(fs.readFileSync(file, 'utf8').split('\n---\n')[1]).toBe(GUIDE.split('\n---\n')[1]);
    const verified = run(['verify', '--file', file]);
    expect(verified.code).toBe(0);
    expect(JSON.parse(verified.out).results[0]).toMatchObject({ required: true, ok: true });

    expect(run(['stamp', '--file', file, '--english-skipped', 'verbatim']).code).toBe(0);
    expect(parseFrontmatter(fs.readFileSync(file, 'utf8')).sourceDistance.englishSkipped).toBe(
      'verbatim'
    );
    expect(run(['stamp', '--file', file, '--clear-english-skipped']).code).toBe(0);
    expect(parseFrontmatter(fs.readFileSync(file, 'utf8')).sourceDistance.englishSkipped).toBe(
      undefined
    );

    fs.writeFileSync(align, JSON.stringify({ alignments: [{ c: 'C1', s: [] }] }));
    expect(run(['score', '--segments', segFile, '--alignment', align]).code).toBe(2);

    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('值班交接', '值班的交接'));
    const stale = run(['verify', '--file', file]);
    expect(stale.code).toBe(5);
    expect(stale.err).toContain(`${file}: sourceDistance is stale`);
    expect(run([...stampArgs, '--rewrites', '0', '--aligner-calls', '2']).code).toBe(4);
  });
});
