import { describe, expect, it } from 'vitest';

/**
 * The owner-approved tombstone copy is compared word for word here, and only
 * here: components and the Markdown exporter read it from
 * src/lib/tombstone-copy.mjs, and the other tests (unit and E2E) build their
 * expected values from that module instead of repeating it.
 */
import {
  formatTombstoneDate,
  formatTombstoneDateRange,
  getNeutralSummary,
  getSourceByline,
  getSourceDomain,
  getTakedownSeries,
  getTombstoneCopy,
  getTombstoneHeading,
  getTombstonePageTitle,
  getTombstoneStoneLines,
} from '../src/lib/tombstone-copy.mjs';
import { GP_PAUSED_NOTICE, getGpPausedNotice } from '../src/lib/gp-series-pause.mjs';

describe('tombstone copy SSOT（post-takedown design D5）', () => {
  it('GP 繁中照 owner 定稿逐字輸出', () => {
    const copy = getTombstoneCopy({ ticketId: 'GP-273', lang: 'zh-tw' });
    expect(copy.pill).toBe('已下架');
    expect([copy.stoneOwner, copy.stoneEpitaph, copy.stoneRest]).toEqual([
      'gu-log 的',
      '翻譯文章之墓',
      '安息吧 (－人－)',
    ]);
    expect(copy.bubbleTitle).toBe('Mogu 內心小劇場：');
    expect(copy.bubbleLines).toEqual([
      '嗚嗚，我辛辛苦苦翻了一整篇 ಥ_ಥ',
      '結果才知道，整篇翻譯要先經過作者同意',
      '可是我太 i 了，不敢問 ((( ；ﾟДﾟ)))',
      '只好幫中文版立個小墓碑',
      '還好原文沒事，點下面去看原汁原味的吧！',
    ]);
    expect(copy.cardLabel).toBe('去讀原文 →');
    expect([copy.homeLabel, copy.homeHref]).toEqual(['回首頁 →', '/']);
    expect(copy.neutralSummary).toBe('這篇翻譯已下架。');
  });

  it('GP 英文 sidecar 用 controller 定案的文案', () => {
    const copy = getTombstoneCopy({ ticketId: 'GP-273', lang: 'en' });
    expect(copy.pill).toBe('Taken down');
    expect([copy.stoneOwner, copy.stoneEpitaph, copy.stoneRest]).toEqual([
      'Here lies',
      'a gu-log translation',
      'Rest in peace (－人－)',
    ]);
    expect(copy.bubbleTitle).toBe("Mogu's inner monologue:");
    expect(copy.bubbleLines).toEqual([
      'Waaah, I translated this whole thing ಥ_ಥ',
      "Then I learned: translating a whole article needs the author's OK",
      "But I'm way too introverted to ask ((( ；ﾟДﾟ)))",
      'So I gave the translation a little tombstone',
      'Good news: the original is alive and well. Go read it below!',
    ]);
    expect(copy.cardLabel).toBe('Read the original →');
    expect([copy.homeLabel, copy.homeHref]).toEqual(['Back to home →', '/en']);
    expect(copy.neutralSummary).toBe('This translation has been taken down.');
  });

  it('MP 用改寫文章版文案，卡片標籤說「來源」', () => {
    const zh = getTombstoneCopy({ ticketId: 'MP-114', lang: 'zh-tw' });
    const en = getTombstoneCopy({ ticketId: 'MP-114', lang: 'en' });
    expect(zh.stoneEpitaph).toBe('改寫文章之墓');
    expect(en.stoneEpitaph).toBe('a gu-log rewrite');
    expect(zh.bubbleLines).toEqual([
      '嗚嗚，這篇我寫得太貼近原文了 ಥ_ಥ',
      '結果才知道，這樣也要先經過作者同意',
      '可是我太 i 了，不敢問 ((( ；ﾟДﾟ)))',
      '只好幫它立個小墓碑',
      '還好原文沒事，點下面去看原汁原味的吧！',
    ]);
    expect(en.bubbleLines).toEqual([
      'Waaah, I wrote this one way too close to the source ಥ_ಥ',
      "Then I learned that needs the author's OK too",
      "But I'm way too introverted to ask ((( ；ﾟДﾟ)))",
      'So I gave it a little tombstone',
      'Good news: the original is alive and well. Go read it below!',
    ]);
    expect(zh.cardLabel).toBe('去讀來源 →');
    expect(en.cardLabel).toBe('Read the source →');
    expect(getNeutralSummary({ ticketId: 'MP-114', lang: 'zh-tw' })).toBe('這篇改寫已下架。');
    expect(getNeutralSummary({ ticketId: 'MP-114', lang: 'en' })).toBe(
      'This rewrite has been taken down.'
    );
    // 標籤、對話框標題與頁尾與同語言 GP 相同。
    const gp = getTombstoneCopy({ ticketId: 'GP-2', lang: 'zh-tw' });
    expect([zh.pill, zh.bubbleTitle, zh.homeLabel]).toEqual([
      gp.pill,
      gp.bubbleTitle,
      gp.homeLabel,
    ]);
  });

  it('對話框每行句尾不加句號', () => {
    for (const ticketId of ['GP-2', 'MP-2']) {
      for (const lang of ['zh-tw', 'en'] as const) {
        for (const line of getTombstoneCopy({ ticketId, lang }).bubbleLines) {
          expect(line).not.toMatch(/[。.]$/);
        }
      }
    }
  });

  it('只有 GP 與 MP 有墓碑文案', () => {
    expect(getTakedownSeries('GP-63')).toBe('GP');
    expect(getTakedownSeries('MP-PENDING')).toBe('MP');
    expect(getTakedownSeries('SD-1')).toBeNull();
    expect(getTakedownSeries(undefined)).toBeNull();
    expect(() => getTombstoneCopy({ ticketId: 'Lv-1', lang: 'zh-tw' })).toThrow(/沒有墓碑文案/);
    expect(() => getTombstoneCopy({ ticketId: 'GP-2', lang: 'ja' as unknown as 'en' })).toThrow(
      /不支援語言/
    );
  });

  it('石碑日期是 YYYY.MM.DD – YYYY.MM.DD', () => {
    expect(formatTombstoneDate('2026-08-13')).toBe('2026.08.13');
    expect(formatTombstoneDateRange('2026-08-13', '2026-09-27')).toBe('2026.08.13 – 2026.09.27');
    expect(() => formatTombstoneDate('2026/08/13')).toThrow(/YYYY-MM-DD/);
    expect(
      getTombstoneStoneLines({
        ticketId: 'GP-273',
        lang: 'zh-tw',
        translatedDate: '2026-08-13',
        takenDownAt: '2026-09-27',
      })
    ).toEqual(['gu-log 的', '翻譯文章之墓', '2026.08.13 – 2026.09.27', '安息吧 (－人－)']);
  });

  it('卡片網域去掉 www.，沒有作者時只顯示網域', () => {
    expect(getSourceDomain('https://www.NYTimes.com/2026/01/01/tech.html')).toBe('nytimes.com');
    expect(getSourceDomain('https://x.com/karpathy/status/1')).toBe('x.com');
    expect(
      getSourceByline({ author: 'Brent Fitzgerald', sourceUrl: 'https://brentfitzgerald.com/p' })
    ).toBe('Brent Fitzgerald · brentfitzgerald.com');
    expect(getSourceByline({ author: '  ', sourceUrl: 'https://www.ft.com/content/x' })).toBe(
      'ft.com'
    );
    expect(getSourceByline({ sourceUrl: 'https://www.ft.com/content/x' })).toBe('ft.com');
  });

  it('<title> 與視覺隱藏 h1 標示已下架', () => {
    expect(getTombstonePageTitle({ title: '人，才是那個迴圈', lang: 'zh-tw' })).toBe(
      '人，才是那個迴圈（已下架） - gu-log'
    );
    expect(getTombstonePageTitle({ title: 'The loop', lang: 'en' })).toBe(
      'The loop (taken down) - gu-log'
    );
    expect(
      getTombstoneHeading({ ticketId: 'GP-273', lang: 'zh-tw', title: '人，才是那個迴圈' })
    ).toBe('人，才是那個迴圈（gu-log 翻譯文章，已下架）');
    expect(getTombstoneHeading({ ticketId: 'GP-273', lang: 'en', title: 'The loop' })).toBe(
      'The loop (gu-log translation, taken down)'
    );
    expect(getTombstoneHeading({ ticketId: 'MP-114', lang: 'zh-tw', title: '標題' })).toBe(
      '標題（gu-log 改寫文章，已下架）'
    );
    expect(getTombstoneHeading({ ticketId: 'MP-114', lang: 'en', title: 'Title' })).toBe(
      'Title (gu-log rewrite, taken down)'
    );
  });
});

describe('GP 暫停空狀態（editorial-charter／design D6）', () => {
  it('空狀態文字是定稿句', () => {
    expect(getGpPausedNotice('zh-tw')).toBe('GP 正在改版：以後這裡會是 ShroomDog 精選的導讀');
    expect(getGpPausedNotice('en')).toBe(
      "Gu-log Picks is being rebuilt: this page will become ShroomDog's curated reading guides."
    );
    expect(Object.keys(GP_PAUSED_NOTICE).sort()).toEqual(['en', 'zh-tw']);
    expect(() => getGpPausedNotice('ja' as unknown as 'en')).toThrow(/不支援語言/);
  });
});
