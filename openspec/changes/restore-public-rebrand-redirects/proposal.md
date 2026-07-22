## Why

品牌重構分支目前把所有舊公開列表頁與文章 URL 一律切成 404，會讓既有書籤、搜尋索引與外部引用永久斷裂。內部機器契約應維持 GP／MP／Mogu-only 的不相容切換，但讀者已看過的公開 URL 應在品牌重構成本最低的現在以精確永久轉址承接。

## What Changes

- 修改公開相容性契約：實際存在過的 `/shroomdog-picks`、`/clawd-picks` 列表頁（含英文與純數字分頁）永久轉址到正式 GP／MP 列表頁。
- 以 `quality/brand-taxonomy-post-migration.json` 作為唯一映射來源，讓每筆舊 SP／CP 公開文章 URL 精確永久轉址到對應 GP／MP 正式 URL；不以前綴猜測 slug。
- 網站地圖與儲存庫新產生的連結仍只輸出正式 URL；taxonomy 檢查仍禁止新增舊契約，只有受控轉址映射可出現舊 slug。
- 驗證每筆轉址的精確 `Location`、跟隨後 200、無自我迴圈／來源衝突，並在真實 Vercel 預覽／正式環境做路由冒煙測試。
- **BREAKING**：frontmatter、ticket ID、API schema、Reader manifest、pipeline、counter、automation、artifact 與 asset path 仍不提供舊 alias；無 manifest 對應的舊 URL 維持 404／410。
- 不存在過的 `/shroom-picks` 列表頁不新增轉址；舊文章若其 slug 含 `shroom-picks`，仍只依 manifest 精確映射。

## Capabilities

### New Capabilities

（無。）

### Modified Capabilities

- `brand-taxonomy`：把讀者端公開 URL 相容性與機器端不相容切換分開；舊列表頁／文章從一律 404 改為受控永久轉址。

## Impact

- **規格：** `openspec/specs/brand-taxonomy/spec.md` 的舊路由與「無相容路徑」需求。
- **路由：** Vercel 可程式化設定在建置時讀既有遷移清單；不新增付費 Bulk Redirects 依賴。
- **測試／CI：** Vercel 設定契約、品牌路由、部署冒煙測試、taxonomy 精確殘留允許清單與網站地圖正式網址檢查。
- **維運：** `docs/rebrand-cutover-runbook.md` 的預覽、切換、復原與正式環境冒煙測試證據。
- **非目標：** 不恢復 SP／CP／Clawd 的儲存、schema、API、Reader、pipeline、counter、automation、artifact 或 asset 相容性。
