/* global URL -- Node 與瀏覽器都有的標準全域 */
/**
 * 下架文章墓碑頁的文案與格式 SSOT（openspec: post-takedown，design D5）。
 *
 * 墓碑元件、Markdown exporter、下架工具、post validator 與 CI 棘輪都從這裡
 * 取字，不要在別處抄一份。GP 繁中是 owner 定稿，不改字；GP 英文與 MP 由
 * controller 定案。對話框每行句尾不加句號。
 */

export const TAKEN_DOWN_STATUS = 'taken-down';

/** 目前有墓碑文案的系列。其他系列要下架，得先在這裡補文案。 */
export const TAKEDOWN_SERIES = Object.freeze(['GP', 'MP']);

const SHARED_COPY = Object.freeze({
  'zh-tw': Object.freeze({
    pill: '已下架',
    bubbleTitle: 'Mogu 內心小劇場：',
    homeLabel: '回首頁 →',
    homeHref: '/',
    pageTitleSuffix: '（已下架）',
  }),
  en: Object.freeze({
    pill: 'Taken down',
    bubbleTitle: "Mogu's inner monologue:",
    homeLabel: 'Back to home →',
    homeHref: '/en',
    pageTitleSuffix: ' (taken down)',
  }),
});

const SERIES_COPY = Object.freeze({
  GP: Object.freeze({
    'zh-tw': Object.freeze({
      stoneOwner: 'gu-log 的',
      stoneEpitaph: '翻譯文章之墓',
      stoneRest: '安息吧 (－人－)',
      bubbleLines: Object.freeze([
        '嗚嗚，我辛辛苦苦翻了一整篇 ಥ_ಥ',
        '結果才知道，整篇翻譯要先經過作者同意',
        '可是我太 i 了，不敢問 ((( ；ﾟДﾟ)))',
        '只好幫中文版立個小墓碑',
        '還好原文沒事，點下面去看原汁原味的吧！',
      ]),
      cardLabel: '去讀原文 →',
      headingSuffix: '（gu-log 翻譯文章，已下架）',
      neutralSummary: '這篇翻譯已下架。',
    }),
    en: Object.freeze({
      stoneOwner: 'Here lies',
      stoneEpitaph: 'a gu-log translation',
      stoneRest: 'Rest in peace (－人－)',
      bubbleLines: Object.freeze([
        'Waaah, I translated this whole thing ಥ_ಥ',
        "Then I learned: translating a whole article needs the author's OK",
        "But I'm way too introverted to ask ((( ；ﾟДﾟ)))",
        'So I gave the translation a little tombstone',
        'Good news: the original is alive and well. Go read it below!',
      ]),
      cardLabel: 'Read the original →',
      headingSuffix: ' (gu-log translation, taken down)',
      neutralSummary: 'This translation has been taken down.',
    }),
  }),
  MP: Object.freeze({
    'zh-tw': Object.freeze({
      stoneOwner: 'gu-log 的',
      stoneEpitaph: '改寫文章之墓',
      stoneRest: '安息吧 (－人－)',
      bubbleLines: Object.freeze([
        '嗚嗚，這篇我寫得太貼近原文了 ಥ_ಥ',
        '結果才知道，這樣也要先經過作者同意',
        '可是我太 i 了，不敢問 ((( ；ﾟДﾟ)))',
        '只好幫它立個小墓碑',
        '還好原文沒事，點下面去看原汁原味的吧！',
      ]),
      cardLabel: '去讀來源 →',
      headingSuffix: '（gu-log 改寫文章，已下架）',
      neutralSummary: '這篇改寫已下架。',
    }),
    en: Object.freeze({
      stoneOwner: 'Here lies',
      stoneEpitaph: 'a gu-log rewrite',
      stoneRest: 'Rest in peace (－人－)',
      bubbleLines: Object.freeze([
        'Waaah, I wrote this one way too close to the source ಥ_ಥ',
        "Then I learned that needs the author's OK too",
        "But I'm way too introverted to ask ((( ；ﾟДﾟ)))",
        'So I gave it a little tombstone',
        'Good news: the original is alive and well. Go read it below!',
      ]),
      cardLabel: 'Read the source →',
      headingSuffix: ' (gu-log rewrite, taken down)',
      neutralSummary: 'This rewrite has been taken down.',
    }),
  }),
});

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * 從 ticketId 取出有墓碑文案的系列（GP／MP）；其他系列回 null。
 * @param {string | undefined | null} ticketId
 * @returns {'GP' | 'MP' | null}
 */
export function getTakedownSeries(ticketId) {
  const prefix = typeof ticketId === 'string' ? ticketId.split('-')[0] : '';
  return TAKEDOWN_SERIES.includes(prefix) ? /** @type {'GP' | 'MP'} */ (prefix) : null;
}

function assertLang(lang) {
  if (lang !== 'zh-tw' && lang !== 'en') {
    throw new Error(`墓碑文案不支援語言 ${JSON.stringify(lang)}（只有 zh-tw 與 en）`);
  }
}

/**
 * 取得某篇下架文章的完整墓碑文案。
 * @param {{ ticketId: string, lang: 'zh-tw' | 'en' }} options
 */
export function getTombstoneCopy({ ticketId, lang }) {
  assertLang(lang);
  const series = getTakedownSeries(ticketId);
  if (!series) {
    throw new Error(
      `${ticketId} 沒有墓碑文案：目前只支援 ${TAKEDOWN_SERIES.join('、')} 下架（src/lib/tombstone-copy.mjs）`
    );
  }
  return { series, lang, ...SHARED_COPY[lang], ...SERIES_COPY[series][lang] };
}

/**
 * 下架文章 `summary` 應該換成的中性句。
 * @param {{ ticketId: string, lang: 'zh-tw' | 'en' }} options
 */
export function getNeutralSummary(options) {
  return getTombstoneCopy(options).neutralSummary;
}

/**
 * `YYYY-MM-DD` → `YYYY.MM.DD`（石碑日期格式）。
 * @param {string} value
 */
export function formatTombstoneDate(value) {
  const match = typeof value === 'string' ? value.match(DATE_PATTERN) : null;
  if (!match) {
    throw new Error(`墓碑日期必須是 YYYY-MM-DD，拿到 ${JSON.stringify(value)}`);
  }
  return `${match[1]}.${match[2]}.${match[3]}`;
}

/**
 * 石碑上的日期行：發表日期 – 下架日期。
 * @param {string} publishedDate
 * @param {string} takenDownAt
 */
export function formatTombstoneDateRange(publishedDate, takenDownAt) {
  return `${formatTombstoneDate(publishedDate)} – ${formatTombstoneDate(takenDownAt)}`;
}

/**
 * 卡片上的網域：`sourceUrl` 的 hostname 去掉開頭 `www.`。
 * @param {string} sourceUrl
 */
export function getSourceDomain(sourceUrl) {
  return new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, '');
}

/**
 * 卡片第二行：「author · 網域」；沒有 author 時只顯示網域。
 * @param {{ author?: string | null, sourceUrl: string }} options
 */
export function getSourceByline({ author, sourceUrl }) {
  const domain = getSourceDomain(sourceUrl);
  const trimmedAuthor = typeof author === 'string' ? author.trim() : '';
  return trimmedAuthor ? `${trimmedAuthor} · ${domain}` : domain;
}

/**
 * 墓碑頁的 `<title>`。
 * @param {{ title: string, lang: 'zh-tw' | 'en' }} options
 */
export function getTombstonePageTitle({ title, lang }) {
  assertLang(lang);
  return `${title}${SHARED_COPY[lang].pageTitleSuffix} - gu-log`;
}

/**
 * 墓碑頁的視覺隱藏 h1。墓碑 Markdown 不用它：exporter 照 post-markdown-representation
 * 的規則，H1 一律是文章原標題。
 * @param {{ ticketId: string, lang: 'zh-tw' | 'en', title: string }} options
 */
export function getTombstoneHeading({ ticketId, lang, title }) {
  return `${title}${getTombstoneCopy({ ticketId, lang }).headingSuffix}`;
}

/**
 * 石碑的四行字，依序是擁有者、墓名、日期、安息。
 * @param {{ ticketId: string, lang: 'zh-tw' | 'en', translatedDate: string, takenDownAt: string }} options
 */
export function getTombstoneStoneLines({ ticketId, lang, translatedDate, takenDownAt }) {
  const copy = getTombstoneCopy({ ticketId, lang });
  return [
    copy.stoneOwner,
    copy.stoneEpitaph,
    formatTombstoneDateRange(translatedDate, takenDownAt),
    copy.stoneRest,
  ];
}
