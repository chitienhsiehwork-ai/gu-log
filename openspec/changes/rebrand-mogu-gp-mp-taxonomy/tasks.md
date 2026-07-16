## 0. Proposal gate

- [ ] 0.1 建立 draft PR，記錄 ShroomDog 已核准 breaking URL / schema / taxonomy cutover。
- [ ] 0.2 Proposal reviewer 審查 `proposal.md` / `design.md` / specs，確認完整 migration、living specs 與 factual exclusions 沒有互相矛盾。
- [ ] 0.3 記錄 user checkpoint：ShroomDog 已明確選擇 ground-up Mogu / GP / MP，不保留舊 URL / schema / command compatibility。

## 1. Inventory and migration manifest

- [ ] 1.1 產生 active tree 的 legacy-token inventory，依 contract / factual term / history / deployment coordinate 分類。
- [ ] 1.2 產生並 commit 所有 SP→GP、CP→MP post 的 tracked old→new ticketId / filename / slug manifest（含 language / pair）；驗證一對一、無碰撞、translation pair 完整。
- [ ] 1.3 列出 derived data、cross-reference、queue、pipeline、route、asset、CSS、test fixture 與 OpenSpec example consumers。
- [ ] 1.4 建立 deterministic residual checker 與窄化 allowlist；先用現況 red test 證明會抓到 legacy contract。

## 2. Core additive-read migration（只允許暫存在 feature branch）

- [ ] 2.1 `src/content.config.ts`、post validator、API/search/feed/filter/badge 暫時能讀現況且完整支援 `GP | MP | SD | Lv`；new writes 只產 canonical values。
- [ ] 2.2 Tribunal types、judge prompts、pass bar、score writer、frontmatter helpers 與 UI 支援 `moguNote`，以測試釘住各 tribunalVersion 的 clarity ownership 與 score 不變。
- [ ] 2.3 Content gates / Obsidian importer / lint masking 完整支援 `MoguNote`；branch 過渡 commit 仍可讀舊 component。
- [ ] 2.4 Counter implementation / tests 支援 GP/MP key；先保留過渡讀取直到 corpus/counter file 同步切換。
- [ ] 2.5 建立 `tools/gp-pipeline/` canonical Go module / command，更新 defaults、prompts、fixtures、doctor；舊 path 暫時只作 branch 過渡。
- [ ] 2.6 Mogu Picks automation 支援 Mogu / MP 的 prompt、config、queue、runner、candidate vocabulary、branch/commit output。
- [ ] 2.7 Feed API 明確 bump taxonomy/schema version，並 audit gu-log-ios consumer 對 prefix、ticketId、slug、URL 的解析；需要跨 repo 修改時建立連結的 tracking/PR，不讓 break 靜默發生。

## 3. Corpus and route migration

- [ ] 3.1 Idempotent codemod 遷移所有 active frontmatter ticket ID、dedup refs、deprecatedBy、series refs、score keys、imports / tags / glossary anchors 與 persona prose。
- [ ] 3.2 `git mv` 所有 SP/CP/legacy series filenames 到 `gp-` / `mp-` canonical slugs，包含 zh-tw / en pair。
- [ ] 3.3 改寫所有 repo-owned post links、brief references、glossary `definedIn` / related、series navigation 與 test fixtures。
- [ ] 3.4 先修 `build-version-manifest.mjs` 的 full-history output domain，使它只輸出 current canonical posts；再重新產生 translation pairs、post versions、reader revisions、search/feed artifacts 與其他 derived manifests。
- [ ] 3.5 第二次執行 codemod必須 zero diff；mapping target、translation anomaly 與 repo-owned link resolution 不得比 migration 前惡化。

## 4. Cleanup to canonical-only contract

- [ ] 4.1 Schema / validator / counter / API / pipeline 移除 SP/CP 舊讀取並啟用 hard failure diagnostics。
- [ ] 4.2 刪除 `ClawdNote.astro`、legacy listing route、redirect、`tools/sp-pipeline`、SP wrapper / shim、舊 binary 與 runtime fallback。
- [ ] 4.3 將 listing routes 收斂成 GP `/gu-log-picks` 與 MP `/mogu-picks`（含 `/en`）；舊 listing/post URL 回 404，不 redirect / render。
- [ ] 4.4 清除 `clawd-picks` / `shroom-picks` / `shroomdog-picks` content-type tags，不建立新的 series tag；UI 以 ticketId 為 series SSOT。
- [ ] 4.5 啟用 deterministic residual checker；immutable history scope 與 active exact exceptions 按 design 中央化。

## 5. Docs, prompts, assets, and active specs

- [ ] 5.1 更新 `CONTRIBUTING.md`、`GU-LOG_WRITER_PROMPT.md`、AGENTS / CLAUDE routing、playbooks、runbooks、judge prompts 與 skill docs，只保留 canonical terminology。
- [ ] 5.2 更新 Mogu/GP/MP public assets、alt text、ARIA labels、CSS class / variable names與 visual comments；被其他狀態元件借用的 SP/CP 色彩改為 semantic tokens。
- [ ] 5.3 透過 delta/archive 更新 active OpenSpec examples 的 ticket IDs / agent identity；保留 archive/history 的原始決策證據。
- [ ] 5.4 Tracked deployment docs / scripts 改用 `tribunal VM`、`$HOME`、`$GU_LOG_DIR` 等中性表達；machine-specific `clawd-vm` / `/home/clawd` mapping 留在 local machine note，無法移除者才做 exact exception。

## 6. Verification

- [ ] 6.1 Residual checker 通過：active contract legacy occurrences 為零，immutable-history exclusion 與 active exact exceptions 都有精確理由。
- [ ] 6.2 Post validation、content gates、glossary checks、counter tests、Tribunal tests 與完整 JS/TS test suite 通過。
- [ ] 6.3 `tools/gp-pipeline` Go tests、doctor、fetch/eval/write/counter/deploy dry-run fixtures 通過。
- [ ] 6.4 `pnpm exec astro check` 與 `pnpm run build` 通過；所有 repo-owned post links resolve。
- [ ] 6.5 記錄 pathname breaking evidence：Reader Tracker / synced slug、post API identity、Giscus pathname threads、human signals 與舊外部 URL 的預期行為，不把有意 break 誤判成漏測。
- [ ] 6.6 以 uiux-auditor 檢查 dark/light、mobile/desktop 的首頁、GP/MP listing、文章 badge、MoguNote 與搜尋結果。
- [ ] 6.7 Implementation correctness reviewer + simplify reviewer 的 findings 全部處理或明確記錄。

## 7. VM cutover, archive, and ship

- [ ] 7.1 Graceful stop live Mogu Picks producer；記錄停機前 queue / commit / service 狀態。
- [ ] 7.2 將 delta specs sync 到 `openspec/specs/`，把 change archive 到同一個 PR。
- [ ] 7.3 Draft PR CI 全綠後轉 ready。因 `.github/workflows/deploy-smoke-test.yml` 必須更新且 operator policy 禁止 automation 越過 workflow-path guard，若現有權限不能完成 approval，將 merge approval 明確交給 ShroomDog；這是操作授權，不是產品決策。
- [ ] 7.4 Merge 後同步 VM checkout，切換 prompt/config/runner invocation，執行 no-publish canary；成功才 resume producer，失敗則回退 repo + invocation 後再恢復。
- [ ] 7.5 等待 Vercel production deploy，smoke test canonical GP/MP/Mogu URLs；舊 route 回 404，search/feed/API 不輸出 SP/CP/Clawd contract。
- [ ] 7.6 回報 production URLs、breaking behavior、model/harness/env signature 與任何保留的 deployment-coordinate exception。
