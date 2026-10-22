/**
 * 中英翻譯配對必須一致的 frontmatter（validate-posts Rule 14，#1164）：
 * `ticketId`、`series`（名稱與 order）和外部來源的 `sourceUrl`。
 *
 * 英文版少了 `series`，英文站的 SeriesNav 就會少算文章、改顯示相關文章；
 * `sourceUrl` 不同代表兩篇根本不是同一個來源。原創文（SD／Lv）的 `sourceUrl`
 * 指向自己的文章網址，中英本來就不同，所以兩邊都不是外部來源時不比。
 * `translatedDate` 刻意不比，原因見 `src/content.config.ts`。
 */
import { isExternalSource } from './source-distance.mjs';

const seriesKey = (series) =>
  series && typeof series === 'object' ? `${series.name}\u0000${series.order}` : null;

/**
 * @param {Record<string, any>} fm 這篇的 frontmatter
 * @param {{ filename: string; ticketId?: string; series?: unknown; sourceUrl?: string } | null} pair
 *   翻譯配對（validate-posts 預先讀好的摘要），沒有配對就傳 null
 * @returns {string[]} 錯誤訊息
 */
export function findPairFieldMismatches(fm, pair) {
  if (!pair) return [];
  const errors = [];
  if (fm.ticketId && pair.ticketId && pair.ticketId !== fm.ticketId) {
    errors.push(
      `Translation pair ticketId mismatch: this="${fm.ticketId}", pair="${pair.ticketId}" (${pair.filename})`
    );
  }
  const differs = (field) =>
    `Translation pair ${pair.filename} has a different ${field} (${JSON.stringify(pair[field] ?? null)} vs ${JSON.stringify(fm[field] ?? null)})`;
  if (seriesKey(fm.series) !== seriesKey(pair.series)) errors.push(differs('series'));
  const external = isExternalSource(fm.sourceUrl) || isExternalSource(pair.sourceUrl);
  if (external && fm.sourceUrl !== pair.sourceUrl) errors.push(differs('sourceUrl'));
  return errors;
}
