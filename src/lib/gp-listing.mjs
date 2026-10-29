/**
 * GP（Gu-log Picks）列表規則（openspec: gp-signature-picks）。
 *
 * GP 是 ShroomDog 指定的招牌文章。GP 系列頁與首頁的 GP 區只列公開的 GP；系列頁一篇都沒有時
 * 顯示中性的空狀態，不宣稱暫停或改版。下架的墓碑由 getListablePosts 依 status 排除。GP-1 是
 * 示範文，不是招牌：照舊可用網址、RSS 與搜尋讀到，但不列在系列頁與首頁。
 */

export const GP_DEMO_TICKET = 'GP-1';

/**
 * 這個 ticket 會不會出現在 GP 列表。
 * @param {string | undefined} ticketId
 */
export function isListedGpTicket(ticketId) {
  return typeof ticketId === 'string' && ticketId.startsWith('GP-') && ticketId !== GP_DEMO_TICKET;
}

/** 首頁 GP 區最多放幾篇。 */
export const HOME_GP_LIMIT = 3;

const ticketNumber = (ticketId) => Number(/\d+$/.exec(ticketId ?? '')?.[0] ?? 0);

/**
 * 首頁的 GP 區：從該語言可列的文章（getListablePosts）挑出過 publish bar 的 GP，最新的
 * HOME_GP_LIMIT 篇。`picks` 是空的就整區不輸出；有輸出、而且系列頁列的比首頁放的多，才顯示
 * 「查看全部」。
 * publish bar 由呼叫端傳入（meetsPublishBar），這裡不重寫門檻。
 *
 * @template {{ data: { ticketId?: string, scores?: any } }} T
 * @param {T[]} listable
 * @param {(scores: any) => boolean} meetsPublishBar
 * @returns {{ picks: T[], showViewAll: boolean }}
 */
export function selectHomeGpBlock(listable, meetsPublishBar) {
  const listed = listable.filter((post) => isListedGpTicket(post.data.ticketId));
  const picks = listed
    .filter((post) => meetsPublishBar(post.data.scores))
    .sort((a, b) => ticketNumber(b.data.ticketId) - ticketNumber(a.data.ticketId))
    .slice(0, HOME_GP_LIMIT);
  return { picks, showViewAll: picks.length > 0 && listed.length > picks.length };
}

/** GP 系列頁沒有任何公開的招牌文章時的空狀態文字。 */
export const GP_EMPTY_NOTICE = Object.freeze({
  'zh-tw': '還沒有招牌文章。',
  en: 'No signature picks yet.',
});

/**
 * @param {'zh-tw' | 'en'} lang
 */
export function getGpEmptyNotice(lang) {
  const notice = GP_EMPTY_NOTICE[lang];
  if (!notice) throw new Error(`GP 空狀態文案不支援語言 ${JSON.stringify(lang)}`);
  return notice;
}
