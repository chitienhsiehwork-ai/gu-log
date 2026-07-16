## 0. Proposal gate

- [x] 0.1 建立 draft PR，記錄 ShroomDog 已核准 breaking URL / schema / taxonomy cutover。
- [x] 0.2 Proposal reviewer 審查 `proposal.md` / `design.md` / specs，確認完整 migration、living specs 與 factual exclusions 沒有互相矛盾。
- [x] 0.3 記錄 user checkpoint：ShroomDog 已明確選擇 ground-up Mogu / GP / MP，不保留舊 URL / schema / command compatibility。

## 1. Inventory and migration manifest

- [ ] 1.1 產生 active tree 的 legacy-token inventory，依 contract / factual term / history / deployment coordinate 分類。
- [ ] 1.2 產生並 commit 所有 SP→GP、CP→MP post 的 tracked old→new ticketId / filename / slug manifest（含 language / pair）；驗證一對一、無碰撞、translation pair 完整。
- [ ] 1.3 列出 derived data、cross-reference、queue、pipeline、route、asset、CSS、test fixture 與 OpenSpec example consumers。
- [ ] 1.4 建立 deterministic residual checker 與窄化 allowlist；先用現況 red test 證明會抓到 legacy contract。
- [ ] 1.5 Residual fixtures SHALL 包含不在字首的舊 ID/slug token（例如 `SP63`、`sp57`），避免 checker 只會抓 `sp-` / `cp-` 開頭。

## 2. Core additive-read migration（只允許暫存在 feature branch）

- [ ] 2.1 `src/content.config.ts`、post validator、API/search/feed/filter/badge 暫時能讀現況且完整支援 `GP | MP | SD | Lv`；new writes 只產 canonical values。
- [ ] 2.2 Tribunal types、judge prompts、pass bar、score writer、frontmatter helpers 與 UI 支援 `moguNote`，以測試釘住各 tribunalVersion 的 clarity ownership 與 score 不變。
- [ ] 2.3 Content gates / Obsidian importer / lint masking 完整支援 `MoguNote`；branch 過渡 commit 仍可讀舊 component。
- [ ] 2.4 Counter implementation / tests 支援 GP/MP key；先保留過渡讀取直到 corpus/counter file 同步切換。
- [ ] 2.5 建立 `tools/gp-pipeline/` canonical Go module / command，更新 defaults、prompts、fixtures、doctor；舊 path 暫時只作 branch 過渡。
- [ ] 2.6 Mogu Picks automation 支援 Mogu / MP 的 prompt、config、queue、runner、candidate vocabulary、branch/commit output。
- [ ] 2.7 Static feed bump 到 v2、prefix 改 GP/MP、detail response 加 `schemaVersion: 2`，並共用 localized URL helper 修正 EN feed link 目前指到 404 的既存 bug；更新 API/snapshot tests。
- [ ] 2.8 gu-log-ios audit evidence：目前只有 untracked local prototype、沒有 deployed/tracked consumer，所以不阻擋本 PR；正式 ship iOS 前另行建立 repo並改為 consume feed v2，刪除 SP/CP/legacy-slug fallback。

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
- [ ] 4.4 清除 `clawd-picks` / `mogu-picks` / `shroom-picks` / `shroomdog-picks` / 過渡 `gu-log-picks` content-type tags，不建立新的 series tag；UI 以 ticketId 為 series SSOT。
- [ ] 4.5 啟用 deterministic residual checker；immutable history scope 與 active exact exceptions 按 design 中央化。

## 5. Docs, prompts, assets, and active specs

- [ ] 5.1 更新 `CONTRIBUTING.md`、`GU-LOG_WRITER_PROMPT.md`、AGENTS / CLAUDE routing、playbooks、runbooks、judge prompts 與 skill docs，只保留 canonical terminology。
- [ ] 5.2 更新 Mogu/GP/MP public assets、alt text、ARIA labels、CSS class / variable names與 visual comments；被其他狀態元件借用的 SP/CP 色彩改為 semantic tokens。
- [ ] 5.3 透過 delta/archive 更新 active OpenSpec examples 的 ticket IDs / agent identity；保留 archive/history 的原始決策證據。
- [ ] 5.4 Tracked deployment docs / scripts 改用 `tribunal VM`、`$HOME`、`$GU_LOG_DIR` 等中性表達；machine-specific `clawd-vm` / `/home/clawd` mapping 留在 local machine note，無法移除者才做 exact exception。
- [ ] 5.5 更新外部 identity SSOT：本機 `~/.config/machine.md` 將 host role 改為 Mogu + Iris（保留 legacy host coordinate）；VM `~/clawd/AGENTS.md`、Mogu Picks prompt/config 與相關 skills 將 public/operator identity 改為 Mogu，絕不輸出或搬動 secrets。

## 6. Verification

- [ ] 6.1 Residual checker 通過：active contract legacy occurrences 為零，immutable-history exclusion 與 active exact exceptions 都有精確理由。
- [ ] 6.2 Post validation、content gates、glossary checks、counter tests、Tribunal tests 與完整 JS/TS test suite 通過。
- [ ] 6.3 `tools/gp-pipeline` Go tests、doctor、fetch/eval/write/counter/deploy dry-run fixtures 通過。
- [ ] 6.4 `pnpm exec astro check` 與 `pnpm run build` 通過；所有 repo-owned post links resolve。
- [ ] 6.5 記錄 pathname breaking evidence：Reader Tracker / synced slug、post API identity、Giscus pathname threads、human signals、RSS item links 與舊外部 URL 的預期行為，不把有意 break 或 RSS client 視為新 item 的結果誤判成漏測。
- [ ] 6.6 以 uiux-auditor 檢查 dark/light、mobile/desktop 的首頁、GP/MP listing、文章 badge、MoguNote 與搜尋結果。
- [ ] 6.7 Implementation correctness reviewer + simplify reviewer 的 findings 全部處理或明確記錄。

## 7. VM cutover, archive, and ship

- [ ] 7.1 將 delta specs sync 到 `openspec/specs/`，把 change archive 到同一個 PR；correctness / simplify review 與 CI 全綠。
- [ ] 7.2 執行 SDLC final human checkpoint②：呈現完整 diff、migration evidence、breaking impact、review findings、CI 與 rollback；取得 ShroomDog 對 merge + live cutover 的明確批准。
- [ ] 7.3 Checkpoint② 通過後確認現況已 disabled 的 CP Writer / Shroom Feed producer fence 仍成立；若已被恢復則 graceful disable 並等待 active run 結束。不要停止整個 OpenClaw gateway。
- [ ] 7.4 因 `.github/workflows/deploy-smoke-test.yml` 必須更新且 operator policy 禁止 automation 越過 workflow-path guard，若現有權限不能完成 merge approval，交由 ShroomDog 執行；這是操作授權，不是產品設計決策。
- [ ] 7.5 Merge 後從 `origin/main` 建 blue/green fresh VM worktree（舊 checkout stale/dirty，不 pull/reset）；用 `openclaw cron` 切 job message/name，新增 repo 外 `mp-writer.md` 並更新 Shroom Feed MP enqueue path，不手改 SQLite / migrated JSON。
- [ ] 7.6 在 fresh checkout 以 `tools/gp-pipeline/gp-pipeline doctor` 與 GP/MP `run --dry-run` 做 no-publish canary；只產 GP/MP-PENDING + MoguNote、repo保持 clean 才 resume。失敗則 job 指回保留的舊 entrypoint，通過舊 dry-run 後才恢復。
- [ ] 7.7 等待 Vercel production deploy，smoke test canonical GP/MP/Mogu URLs；舊 route 回 404，search/feed/API 不輸出 SP/CP/Clawd contract。
- [ ] 7.8 回報 production URLs、breaking behavior、model/harness/env signature 與任何保留的 deployment-coordinate exception。
