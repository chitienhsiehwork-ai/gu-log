## 0. 提案門檻

- [x] 0.1 建立 draft PR，記錄 ShroomDog 已核准 URL、schema 與分類法的破壞性切換。
- [x] 0.2 提案 reviewer 審查 `proposal.md`、`design.md` 與規格，確認完整遷移、現行規格與事實性排除沒有互相矛盾。
- [x] 0.3 記錄使用者檢查點：ShroomDog 已明確選擇從根重做 Mogu／GP／MP，不保留舊 URL、schema 或指令相容性。

## 1. 盤點與遷移 manifest

- [x] 1.1 產生 active tree 的 legacy-token 盤點，依 contract、事實名詞、歷史與部署座標分類。
- [x] 1.2 產生並 commit 所有 SP→GP、CP→MP 文章的 tracked old→new ticketId／檔名／slug manifest（含語言與配對）；驗證一對一、無碰撞、翻譯配對完整。
- [x] 1.3 列出衍生資料、跨檔引用、佇列、pipeline、路由、資產、CSS、測試 fixture 與 OpenSpec 範例消費端。
- [x] 1.4 建立 deterministic 遺留項檢查器與窄化允許清單；先用現況失敗測試證明會抓到 legacy contract。
- [x] 1.5 遺留項測試資料 SHALL 包含不在字首的舊 ID／slug token（例如 `SP63`、`sp57`），避免檢查器只會抓 `sp-`／`cp-` 開頭。

## 2. 核心 contract 遷移結果

- [x] 2.1 `src/content.config.ts`、文章驗證器、API、搜尋、RSS、篩選與 badge 只接受並輸出 `GP | MP | SD | Lv` 正式值。
- [x] 2.2 Tribunal 類型、judge 提示、pass bar、分數寫入器、frontmatter helpers 與 UI 使用 `moguNote`，並以測試釘住各 tribunalVersion 的 clarity ownership 與 score 不變。
- [x] 2.3 內容門檻、Obsidian importer 與 lint masking 使用 `MoguNote`，不保留舊 component fallback。
- [x] 2.4 Counter 實作與測試只接受 GP／MP key；corpus 與 counter 檔案已同步切換。
- [x] 2.5 建立 `tools/gp-pipeline/` 正式 Go module 與 command，更新 defaults、提示、測試資料與 doctor，並移除舊 entrypoint。
- [x] 2.6 Mogu Picks 自動化支援 Mogu／MP 的 prompt、config、佇列、runner、候選詞彙與 branch／commit 輸出。
- [x] 2.7 靜態 RSS 升到 v2、prefix 改 GP／MP、detail 回應加 `schemaVersion: 2`，並共用 localized URL helper 修正 EN RSS 連結目前指到 404 的既存 bug；API 與 snapshot 測試已更新。
- [x] 2.8 gu-log-ios 稽核證據：目前只有 untracked local prototype、沒有已部署或 tracked consumer，所以不阻擋本 PR；正式發布 iOS 前另行建立 repo 並改為使用 RSS v2，刪除已退役 fallback。

## 3. Corpus 與 route 遷移

- [x] 3.1 可重跑 codemod 遷移所有 active frontmatter ticket ID、dedup refs、deprecatedBy、系列 refs、score keys、imports、tags、glossary anchors 與 persona prose。
- [x] 3.2 `git mv` 所有 SP/CP/legacy series filenames 到 `gp-` / `mp-` canonical slugs，包含 zh-tw / en pair。
- [x] 3.3 改寫所有 repo-owned 文章連結、brief 引用、glossary `definedIn`／related、系列導覽與測試資料。
- [x] 3.4 修正 `build-version-manifest.mjs` 的 full-history 輸出範圍，使它只輸出當前正式文章；重新產生翻譯配對、文章版本、reader revisions、搜尋／RSS artifacts 與其他衍生 manifests。
- [x] 3.5 第二次執行 codemod 為 zero diff；mapping target、翻譯 anomaly 與 repo-owned 連結解析沒有比遷移前惡化。

## 4. 收斂成僅正式值的 contract

- [x] 4.1 Schema、驗證器、counter、API 與 pipeline 移除已退役舊讀取，並啟用強制失敗診斷。
- [x] 4.2 刪除舊 note component、legacy listing 路由、redirect、舊 pipeline、wrapper／shim、舊 binary 與 runtime fallback。
- [x] 4.3 將 listing 路由收斂成 GP `/gu-log-picks` 與 MP `/mogu-picks`（含 `/en`）；舊 listing／post URL 回 404，不 redirect 或 render。
- [x] 4.4 清除已退役與過渡 content-type tags，不建立新的系列 tag；UI 以 ticketId 為系列 SSOT。
- [x] 4.5 啟用 deterministic 遺留項檢查器；immutable history scope 與 active exact exceptions 按 design 中央化。

## 5. 文件、prompts、assets 與現行規格

- [x] 5.1 更新 `CONTRIBUTING.md`、`GU-LOG_WRITER_PROMPT.md`、AGENTS／CLAUDE routing、playbooks、runbooks、judge 提示與 skill 文件，只保留正式術語。
- [x] 5.2 更新 Mogu／GP／MP public assets、alt text、ARIA labels、CSS class／variable names 與 visual comments；被其他狀態元件借用的舊系列色彩改為 semantic tokens。
- [x] 5.3 透過 delta／main spec sync 更新 active OpenSpec examples 的 ticket IDs 與 agent identity；保留 archive／history 的原始決策證據。
- [x] 5.4 Tracked 部署文件與 scripts 改用 `Tribunal VM`、`$TRIBUNAL_HOST`、`$GU_LOG_DIR`、`$HOME` 等中性表達；machine-specific mapping 留在 local machine note，無法移除者才做 exact exception。
- [x] 5.5 建立 tracked cutover runbook，定義人類檢查點②之後才執行的外部 identity SSOT、producer fence、fresh VM worktree 與正式環境切換；archive 前不修改 live VM 或 local machine note。

## 6. 驗證

- [ ] 6.1 遺留項檢查器通過：active contract legacy occurrences 為零，immutable-history exclusion 與 active exact exceptions 都有精確理由。
- [ ] 6.2 文章驗證、內容門檻、glossary checks、counter 測試、Tribunal 測試與完整 JS／TS test suite 通過。
- [ ] 6.3 `tools/gp-pipeline` Go tests、doctor、fetch／eval／write／counter／deploy dry-run 測試資料通過。
- [ ] 6.4 `pnpm exec astro check` 與 `pnpm run build` 通過；所有 repo-owned post links resolve。
- [ ] 6.5 記錄 pathname 破壞性變更證據：Reader Tracker／synced slug、post API identity、Giscus pathname threads、human signals、RSS item links 與舊外部 URL 的預期行為，不把有意中斷或 RSS client 視為新 item 的結果誤判成漏測。
- [ ] 6.6 以 uiux-auditor 檢查 dark／light、mobile／desktop 的首頁、GP／MP listing、文章 badge、MoguNote 與搜尋結果。
- [ ] 6.7 Implementation correctness reviewer 與 simplify reviewer 的 findings 全部處理或明確記錄。

## 7. Spec sync 與 cutover 交付包

- [ ] 7.1 將 delta 規格 intelligent merge 到 `openspec/specs/`，完成 correctness／simplify review 與本機驗證，讓 change 達到 archive-ready；實際 archive 是所有 checkbox 完成後的 workflow 動作。
- [x] 7.2 `docs/rebrand-cutover-runbook.md` 已定義離線終審、人類檢查點②、producer fence、合併、fresh VM、no-publish canary、Vercel 正式環境 smoke 與回退順序；實際 live cutover 明確留在 archive 後。
- [x] 7.3 Cutover evidence template 已涵蓋 model／harness／env signature、CI、雙主題 UI、破壞性影響、rollback、正式路由與 #585 reliability roadmap 接續項目。
