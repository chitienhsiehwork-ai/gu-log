/**
 * GP（Gu-log Picks）暫停收文旗標 SSOT（openspec: editorial-charter、post-takedown design D6）。
 *
 * 整篇翻譯要先取得來源作者同意，GP 因此暫停：系列頁只顯示改版空狀態、首頁不顯示
 * GP 區塊、CI 棘輪擋下新增的 GP 文章。導讀新格式的 change 會把旗標關掉，並重新定義
 * GP 的收文條件。GP-1（自寫示範文）不下架，照舊可用網址、RSS 與搜尋讀到，只是暫停
 * 期間不列在系列頁與首頁。
 */

export const GP_SERIES_PAUSED = true;

/** GP 系列頁在暫停期間的空狀態文字。 */
export const GP_PAUSED_NOTICE = Object.freeze({
  'zh-tw': 'GP 正在改版：以後這裡會是 ShroomDog 精選的導讀',
  en: "Gu-log Picks is being rebuilt: this page will become ShroomDog's curated reading guides.",
});

/**
 * @param {'zh-tw' | 'en'} lang
 */
export function getGpPausedNotice(lang) {
  const notice = GP_PAUSED_NOTICE[lang];
  if (!notice) throw new Error(`GP 暫停文案不支援語言 ${JSON.stringify(lang)}`);
  return notice;
}
