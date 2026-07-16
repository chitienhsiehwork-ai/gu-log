## 0. 提案門檻

- [x] 0.1 建立 draft PR，記錄 ShroomDog 已核准 URL、schema 與分類法的破壞性切換。
- [x] 0.2 提案 reviewer 審查 `proposal.md`、`design.md` 與規格，確認完整遷移、現行規格與事實性排除沒有互相矛盾。
- [x] 0.3 記錄使用者檢查點：ShroomDog 已明確選擇從根重做 Mogu／GP／MP，不保留舊 URL、schema 或指令相容性。

## 1. 盤點與遷移 manifest

- [x] 1.1 產生 active tree 的 legacy-token 盤點，依 contract、事實名詞、歷史與部署座標分類。
- [x] 1.2 產生並 commit 所有 SP→GP、CP→MP 文章的 tracked old→new ticketId／檔名／slug manifest（含語言與配對）；驗證一對一、無碰撞、翻譯配對完整。
- [ ] 1.3 列出衍生資料、跨檔引用、佇列、pipeline、路由、資產、CSS、測試 fixture 與 OpenSpec 範例消費端。
- [ ] 1.4 建立 deterministic 遺留項檢查器與窄化允許清單；先用現況失敗測試證明會抓到 legacy contract。
- [ ] 1.5 遺留項測試資料 SHALL 包含不在字首的舊 ID／slug token（例如 `SP63`、`sp57`），避免檢查器只會抓 `sp-`／`cp-` 開頭。

## 2. 核心 additive-read 遷移（只允許暫存在 feature branch）

- [ ] 2.1 `src/content.config.ts`、文章驗證器、API、搜尋、RSS、篩選與 badge 暫時能讀現況且完整支援 `GP | MP | SD | Lv`；新寫入只產正式值。
- [ ] 2.2 Tribunal 類型、judge 提示、pass bar、分數寫入器、frontmatter helpers 與 UI 支援 `moguNote`，以測試釘住各 tribunalVersion 的 clarity ownership 與 score 不變。
- [ ] 2.3 內容門檻、Obsidian importer 與 lint masking 完整支援 `MoguNote`；branch 過渡 commit 仍可讀舊 component。
- [ ] 2.4 Counter 實作與測試支援 GP／MP key；先保留過渡讀取，直到 corpus 與 counter 檔案同步切換。
- [ ] 2.5 建立 `tools/gp-pipeline/` 正式 Go module 與 command，更新 defaults、提示、測試資料與 doctor；舊 path 暫時只作 branch 過渡。
- [ ] 2.6 Mogu Picks 自動化支援 Mogu／MP 的 prompt、config、佇列、runner、候選詞彙與 branch／commit 輸出。
- [ ] 2.7 靜態 RSS 升到 v2、prefix 改 GP／MP、detail 回應加 `schemaVersion: 2`，並共用 localized URL helper 修正 EN RSS 連結目前指到 404 的既存 bug；更新 API 與 snapshot 測試。
- [ ] 2.8 gu-log-ios 稽核證據：目前只有 untracked local prototype、沒有已部署或 tracked consumer，所以不阻擋本 PR；正式發布 iOS 前另行建立 repo 並改為使用 RSS v2，刪除 SP／CP／legacy-slug fallback。

## 3. Corpus 與 route 遷移

- [x] 3.1 可重跑 codemod 遷移所有 active frontmatter ticket ID、dedup refs、deprecatedBy、系列 refs、score keys、imports、tags、glossary anchors 與 persona prose。
- [x] 3.2 `git mv` 所有 SP/CP/legacy series filenames 到 `gp-` / `mp-` canonical slugs，包含 zh-tw / en pair。
- [ ] 3.3 改寫所有 repo-owned 文章連結、brief 引用、glossary `definedIn`／related、系列導覽與測試資料。
- [ ] 3.4 先修 `build-version-manifest.mjs` 的 full-history 輸出範圍，使它只輸出當前正式文章；再重新產生翻譯配對、文章版本、reader revisions、搜尋／RSS artifacts 與其他衍生 manifests。
- [ ] 3.5 第二次執行 codemod 必須 zero diff；mapping target、翻譯 anomaly 與 repo-owned 連結解析不得比遷移前惡化。

## 4. 收斂成僅正式值的 contract

- [ ] 4.1 Schema、驗證器、counter、API 與 pipeline 移除 SP／CP 舊讀取，並啟用強制失敗診斷。
- [ ] 4.2 刪除 `ClawdNote.astro`、legacy listing 路由、redirect、`tools/sp-pipeline`、SP wrapper／shim、舊 binary 與 runtime fallback。
- [ ] 4.3 將 listing 路由收斂成 GP `/gu-log-picks` 與 MP `/mogu-picks`（含 `/en`）；舊 listing／post URL 回 404，不 redirect 或 render。
- [ ] 4.4 清除 `clawd-picks`、`mogu-picks`、`shroom-picks`、`shroomdog-picks` 與過渡 `gu-log-picks` content-type tags，不建立新的系列 tag；UI 以 ticketId 為系列 SSOT。
- [ ] 4.5 啟用 deterministic 遺留項檢查器；immutable history scope 與 active exact exceptions 按 design 中央化。

## 5. 文件、prompts、assets 與現行規格

- [ ] 5.1 更新 `CONTRIBUTING.md`、`GU-LOG_WRITER_PROMPT.md`、AGENTS／CLAUDE routing、playbooks、runbooks、judge 提示與 skill 文件，只保留正式術語。
- [ ] 5.2 更新 Mogu／GP／MP public assets、alt text、ARIA labels、CSS class／variable names 與 visual comments；被其他狀態元件借用的 SP／CP 色彩改為 semantic tokens。
- [ ] 5.3 透過 delta／archive 更新 active OpenSpec examples 的 ticket IDs 與 agent identity；保留 archive／history 的原始決策證據。
- [ ] 5.4 Tracked 部署文件與 scripts 改用 `tribunal VM`、`$HOME`、`$GU_LOG_DIR` 等中性表達；machine-specific `clawd-vm`／`/home/clawd` mapping 留在 local machine note，無法移除者才做 exact exception。
- [ ] 5.5 更新外部 identity SSOT：本機 `~/.config/machine.md` 將 host role 改為 Mogu + Iris（保留 legacy host coordinate）；VM `~/clawd/AGENTS.md`、Mogu Picks prompt／config 與相關 skills 將 public／operator identity 改為 Mogu，絕不輸出或搬動 secrets。

## 6. 驗證

- [ ] 6.1 遺留項檢查器通過：active contract legacy occurrences 為零，immutable-history exclusion 與 active exact exceptions 都有精確理由。
- [ ] 6.2 文章驗證、內容門檻、glossary checks、counter 測試、Tribunal 測試與完整 JS／TS test suite 通過。
- [ ] 6.3 `tools/gp-pipeline` Go tests、doctor、fetch／eval／write／counter／deploy dry-run 測試資料通過。
- [ ] 6.4 `pnpm exec astro check` 與 `pnpm run build` 通過；所有 repo-owned post links resolve。
- [ ] 6.5 記錄 pathname 破壞性變更證據：Reader Tracker／synced slug、post API identity、Giscus pathname threads、human signals、RSS item links 與舊外部 URL 的預期行為，不把有意中斷或 RSS client 視為新 item 的結果誤判成漏測。
- [ ] 6.6 以 uiux-auditor 檢查 dark／light、mobile／desktop 的首頁、GP／MP listing、文章 badge、MoguNote 與搜尋結果。
- [ ] 6.7 Implementation correctness reviewer 與 simplify reviewer 的 findings 全部處理或明確記錄。

## 7. VM 切換、封存與發布

- [ ] 7.1 將 delta 規格同步到 `openspec/specs/`，把 change 封存到同一個 PR；correctness／simplify review 與 CI 全綠。
- [ ] 7.2 執行 SDLC 最終人類檢查點②：呈現完整 diff、遷移證據、破壞性影響、review findings、CI 與 rollback；取得 ShroomDog 對 merge 與 live cutover 的明確批准。
- [ ] 7.3 檢查點②通過後，確認現況已 disabled 的 CP Writer／Shroom Feed producer fence 仍成立；若已恢復則 graceful disable 並等待 active run 結束。不要停止整個 OpenClaw gateway。
- [ ] 7.4 因 `.github/workflows/deploy-smoke-test.yml` 必須更新，且 operator policy 禁止 automation 越過 workflow-path guard；若現有權限不能完成 merge approval，交由 ShroomDog 執行。這是操作授權，不是產品設計決策。
- [ ] 7.5 Merge 後從 `origin/main` 建 blue／green fresh VM worktree（舊 checkout stale／dirty，不 pull／reset）；用 `openclaw cron` 切換 job message／name，新增 repo 外 `mp-writer.md` 並更新 Shroom Feed MP enqueue path，不手改 SQLite 或 migrated JSON。
- [ ] 7.6 在 fresh checkout 以 `tools/gp-pipeline/gp-pipeline doctor` 與 GP／MP `run --dry-run` 做 no-publish canary；只產 GP／MP-PENDING 與 MoguNote、repo 保持 clean 才 resume。失敗則 job 指回保留的舊 entrypoint，通過舊 dry-run 後才恢復。
- [ ] 7.7 等待 Vercel production deploy，以 smoke test 驗證正式 GP／MP／Mogu URLs；舊 route 回 404，搜尋、RSS 與 API 不輸出 SP／CP／Clawd contract。
- [ ] 7.8 回報 production URLs、破壞性行為、model／harness／env signature 與任何保留的部署座標 exception。
