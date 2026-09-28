/**
 * GP（Gu-log Picks）列表規則（openspec: editorial-charter）。
 *
 * GP 系列頁與首頁的 GP 區塊只列公開的 ShroomDog 精選導讀；一篇都沒有時顯示中性的空狀態，
 * 不宣稱暫停或改版。下架的翻譯由 getListablePosts 依 status 排除。GP-1 是自寫示範文、
 * 不是導讀：照舊可用網址、RSS 與搜尋讀到，但不列在系列頁與首頁。
 */

export const GP_DEMO_TICKET = 'GP-1';

/**
 * 這個 ticket 會不會出現在 GP 列表。
 * @param {string | undefined} ticketId
 */
export function isListedGpTicket(ticketId) {
  return typeof ticketId === 'string' && ticketId.startsWith('GP-') && ticketId !== GP_DEMO_TICKET;
}

/** GP 列表沒有任何公開導讀時的空狀態文字。 */
export const GP_EMPTY_NOTICE = Object.freeze({
  'zh-tw': '這裡還沒有公開的導讀。',
  en: 'No reading guides here yet.',
});

/**
 * @param {'zh-tw' | 'en'} lang
 */
export function getGpEmptyNotice(lang) {
  const notice = GP_EMPTY_NOTICE[lang];
  if (!notice) throw new Error(`GP 空狀態文案不支援語言 ${JSON.stringify(lang)}`);
  return notice;
}
