## Why

文章發布後仍可能因事實更正或正文 voice ownership 改變而重新分類；若新分類換了 ticket 與 slug，既有 canonical URL 不能變成 404，也不能靠保留錯誤系列身份來換取相容性。現有 `brand-taxonomy` contract 只明講一次性的 SP／CP cutover，沒有涵蓋發布後的精確重分類 alias。

## What Changes

- 允許把曾公開發布、後來被重分類或取代的文章 URL 記成精確歷史 alias，永久導向目前 canonical article。
- 允許多個精確歷史 alias 匯流到同一個 canonical destination，同時保留 source 唯一、禁止 self-loop、語言一致與 destination 必須對應現存文章的 fail-closed 檢查。
- 要求 repo 內主動維護的站內連結同時使用目前 canonical URL、ticket label 與標題；歷史 alias 只服務外部舊連結。
- 用 GP-53／SP-53 中英文四條 URL 匯流至 MP-316 的真實案例覆蓋 fan-in regression，不再用欄位互相矛盾的 synthetic manifest fixture 宣告契約。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `brand-taxonomy`: 擴充 reader-facing compatibility boundary，納入已發布 canonical article 後續重分類的精確 alias 與多來源匯流規則。

## Impact

- `quality/brand-taxonomy-post-migration.json` 的歷史 alias 紀錄。
- `vercel.mjs` 的 redirect registry 與 route budget。
- redirect config、canonical public output 與內容完整性測試。
- 指向已重分類文章的 active post links，以及兩份文章版本／reader revision manifests。
