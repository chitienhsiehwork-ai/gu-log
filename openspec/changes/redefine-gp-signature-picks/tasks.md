# Tasks

> - 實作 commit 不碰 `openspec/**/specs/**`；不改 spec 做不下去就停手回報 controller。
> - 一個 commit 一件事。每組做完 `pnpm run test:unit` 要綠，動到 `tools/gp-pipeline` 再跑 `go build ./... && go vet ./... && go test -count=1 ./...`。測試只驗行為與結構化的值，不比對 prompt 原句。
> - 順序：第 1 組最先；第 2 組在 3.4 刪 `scripts/lib/source-distance.mjs` 之前；第 7 組等第 2～5 組完成。
> - Tribunal PASS 只在升格成 GP 時由 `scripts/reclassify-post.mjs` 把關，`validate-posts` 不檢查。

## 1. 共用 helper 搬家

- [ ] 1.1 `isExternalSource`（含它用到的網域判斷）從 `scripts/lib/source-distance.mjs` 搬到 `scripts/lib/external-source.mjs`，呼叫端改 import，測試搬到 `tests/external-source.test.ts`

## 2. 下架來源一律擋（`post-takedown`）

- [ ] 2.1 `scripts/dedup-gate.mjs` 拿掉「GP 只撞到下架 GP 回 WARN」的例外，一律 BLOCK；`tests/dedup-gate.test.ts` 同步（〈自動化 SHALL 依狀態處理下架文章〉）
- [ ] 2.2 `tools/gp-pipeline/internal/dedup/` 與 `cmd/gp-pipeline/dedup.go` 的註解、help、測試同步改成 BLOCK
- [ ] 2.3 `scripts/check-takedown-ratchet.mjs`：拿掉驗章例外；遷移清單有記、`sourceUrl` 沒變的改系列不算新增；改系列文章補上缺少的語言版本不算新增，`--staged` 與 `--base` 都要成立。`scripts/hooks/pre-commit` 註解與 `tests/takedown-ratchet.test.ts` 同步（〈已下架文章與它們的來源 SHALL 被 CI 棘輪鎖住〉）

## 3. 退役來源距離章（`source-distance-stamp`）

- [ ] 3.1 同一個 commit：刪 `scripts/validate-posts.mjs` 的 Rule 1.6、GP-276～279 六個檔的 `sourceDistance`、`src/content.config.ts` 的欄位、`scripts/lib/taken-down-posts.mjs` 的對應項；schema 拒絕帶 `sourceDistance` 的文章，測試同步（`post-takedown`「下架文章留著來源距離章」）
- [ ] 3.2 `scripts/check-translation-pairs.mjs` 拿掉 `englishSkipped` 與 GP 專屬判斷，GP 併進 `PAIRED_PREFIXES`；`tests/translation-pairs.test.ts` 同步
- [ ] 3.3 `scripts/hooks/pre-commit` 刪驗章區塊；`tests/hooks-integration.test.ts`、`tests/helpers/pre-commit-repo.ts` 同步
- [ ] 3.4 刪 `scripts/source-distance.mjs`、`scripts/lib/source-distance.mjs`、`tests/source-distance.test.ts`、`tests/helpers/source-distance-stamp.ts`，同一個 commit 改掉還 import 它們的測試
- [ ] 3.5 `scripts/take-down-posts.mjs`、`scripts/inject-related-posts.mjs`、`vercel.mjs` 提到章或導讀的註解改掉
- [ ] 3.6 `rg -n "sourceDistance|source-distance|englishSkipped|verifyStamp|writeStamp|requiresStamp"`（排除 `openspec/`、`tools/gp-pipeline/`）只剩確認過的命中，寫進 PR 說明

## 4. gp-pipeline 不寫 GP（`gp-signature-picks`；`ShroomDogNote` 與 Lv help 在 `gp-pipeline-publish-integrity`）

- [ ] 4.1 比照 Lv（`internal/pipeline/authoring.go`）在任何副作用前擋 GP：`run`（`--prefix GP`，或 `--file`／`--work-dir` 是 GP 且起點早於 `translate`）、`write`、`review`、`refine`、`ralph`；exit 1，訊息指向 `--prefix MP`。新增 `cmd/gp-pipeline/gp_refusal_test.go`（〈gp-pipeline SHALL NOT 撰寫、改寫或評審 GP〉〈拒絕 GP SHALL 發生在任何副作用之前，並指向先寫 MP〉）
- [ ] 4.2 GP 的非寫作步驟（`counter`、`fetch`、`eval`、`dedup`、`translate`、`credits`、standalone `deploy`、`run --from-step translate|deploy`）照常，缺的測試補上（〈GP SHALL 仍可使用 pipeline 的非寫作步驟〉）
- [ ] 4.3 同一個 commit 刪導讀分支：`run.go`、`state.go` 的 GP 步驟與欄位，`ralph.go` 的 GP 分支，`guide.go`（`containsShroomDogNote`、`rejectShroomDogNote` 搬到 `internal/pipeline/shroomdognote.go`），`sourcedistance.go`、`cmd/gp-pipeline/stamp.go`、`internal/llm/aligner.go`、`align.tmpl`，prompt 模板的 GP 分支，`translate.go` 的逐字檢查；測試同步（「以退役的 source-distance 步驟恢復」）
- [ ] 4.4 移除 aligner 角色：`internal/llm/` 的 routing 與 dispatcher、`cmd/gp-pipeline/llm_helper.go`、`doctor.go`、`config/llm-pipeline.json`、`scripts/tribunal-model-router.sh`、`.claude/agents/source-aligner.md`、`scripts/crontab-tribunal.example`；`scripts/tests/test-tribunal-model-router.sh` 加 `aligner` 回 unknown role
- [ ] 4.5 `shroomdognote.go` 拿掉 GP 限定，`write`、`refine` 對每個系列都檢查（exit 14）；「不得寫 `ShroomDogNote`」的 prompt 規則與 review 檢查移到共用段落；補 MP、SD 的 Go 測試（〈寫作步驟 SHALL 拒絕含 `ShroomDogNote` 的模型輸出〉）
- [ ] 4.6 help 與錯誤訊息只把 MP、SD 列為可撰寫系列，`counter`、`dedup`、`deploy` 照舊列 GP；`help_contract_test.go`、`lv_refusal_test.go` 同步（〈寫作指令的說明與錯誤訊息 SHALL NOT 邀請撰寫 GP〉與 MODIFIED 的 Lv 那條）
- [ ] 4.7 `tools/gp-pipeline/SKILL.md`、`README.md` 拿掉導讀、來源距離、`stamp`；寫明 pipeline 不寫 GP、任何系列輸出 `ShroomDogNote` 都 exit 14、上線前指定 GP 的做法
- [ ] 4.8 `rg` 掃 `tools/gp-pipeline` 的 `SourceDistance|sourceDistance|source-distance|Aligner|aligner|EnglishCheck|englishSkipped|guide|ShroomDogNote|Terminology`，只剩確認過的命中，寫進 PR 說明

## 5. 改系列指令（`gp-signature-picks`）

- [ ] 5.1 新增 `scripts/reclassify-post.mjs <ticketId|繁中檔名> <GP|MP>`：全部拒絕條件先檢查完才動手（升 GP 用 `src/utils/tribunal-scores.ts` 的 `meetsPublishBar`，分數用 `yaml` 解析）；已上線走配號、`git mv`、遷移清單（`counts` 用 `vercel.mjs` 的 `deriveManifestCounts`）、連結（符合 pre-commit 的 link-only 規則）與 counter；上線前只改 `PENDING` 檔名與 `ticketId`；最後跑 `validate-posts`（〈改系列 SHALL 只用一支指令，兩種語言一起搬〉〈上線前的草稿 SHALL 用同一支指令換系列〉〈改系列 SHALL 在動手前拒絕不合法的移動〉）
- [ ] 5.2 `tests/reclassify-post.test.ts`：在暫存 git repo 跑真的 script，涵蓋上面三條 requirement 與升格 requirement 的情境
- [ ] 5.3 測試：GP 重評沒過 PASS 時 `validate-posts` 與 pre-commit 照樣通過（「升格後重評沒過」）

## 6. 首頁、列表與讀者文案（`gp-signature-picks`〈GP 列表…〉；`brand-taxonomy`〈Reader-facing series labels…〉）

- [ ] 6.1 `src/lib/gp-listing.mjs` 改說明與空狀態文案，`tests/tombstone-copy.test.ts` 同步
- [ ] 6.2 `src/pages/index.astro`、`src/pages/en/index.astro`：沒有可列的 GP 就不輸出 GP `<section>`，刪掉用不到的空狀態元素與樣式；副標改成招牌文章
- [ ] 6.3 `src/pages/gu-log-picks/[...page].astro`、`src/pages/en/gu-log-picks/[...page].astro` 的副標同步
- [ ] 6.4 `src/pages/posts/[...slug].astro`、`src/pages/en/posts/[...slug].astro`：GP 跟 MP 一樣顯示「來源材料」／`Source material`；`src/components/ArticleTechnicalDetails.astro` 刪 `reading-guide` 模式
- [ ] 6.5 `src/pages/about.astro`、`src/pages/en/about.astro`、`scripts/article-counter.json` 的系列說明改成 MP 日常、GP 招牌，刪來源距離章段落
- [ ] 6.6 測試：`tests/helpers/gp-listing.ts` 的 `expectGpHomeBlock` 處理沒有 GP 區；`tests/mp-editorial-identity.spec.ts` 的 About 與 GP-1 斷言；`.github/workflows/deploy-smoke-test.yml` 與 `tests/deploy-smoke-workflow.test.ts` 不提導讀
- [ ] 6.7 視覺改動跑雙主題截圖檢查（Claude Code 用 `uiux-auditor`）

## 7. 清理 GP-276～279（`gp-signature-picks`、`brand-taxonomy`、`post-takedown`）

- [ ] 7.1 依號碼順序對 GP-276～279 各跑 `node scripts/reclassify-post.mjs GP-<n> MP`，每篇一個 commit，訊息寫舊號與新號（共 6 個檔，276、277 只有繁中）
- [ ] 7.2 原 GP-276、277 各跑 `tools/gp-pipeline/gp-pipeline translate --file <新繁中檔名>` 補英文版，各一個 commit
- [ ] 7.3 確認：GP counter 不動、MP 前進 4；`check-takedown-ratchet --base=origin/main`、`check-translation-pairs --strict`、`check-brand-taxonomy`、`validate-posts --check-duplicates`、`versions:check`（不過就重建兩份 version manifest 一起 commit）、`tests/vercel-routing-config.test.ts` 都綠
- [ ] 7.4 `.github/workflows/deploy-smoke-test.yml` 加原 GP-278 中英網址 308 到新 MP 網址

## 8. Tribunal 與評審指示（`gp-source-preservation`、`tribunal-focal-source-evidence`、`tribunal-score-persistence`）

- [ ] 8.1 `scripts/tribunal.sh` 拒絕 GP `--allow-rewrite` 的訊息與 `src/lib/tribunal-v2/pipeline.ts` 的註解不再提章；`tests/tribunal-gp-score-only.test.ts`、`tests/tribunal-v2/pipeline.test.ts` 照舊綠
- [ ] 8.2 `.claude/agents/` 與 `.codex/agents/` 的 fact-checker、fresh-eyes、librarian、tribunal-writer、vibe-opus-scorer，以及 `scripts/vibe-scoring-standard.md`：GP 跟 MP 同一套規則，`ShroomDogNote` 歸給 ShroomDog 的規則適用所有系列，不改 model pin（「評審讀到 ShroomDogNote」）
- [ ] 8.2a `src/lib/tribunal-v2/runners/stage-runners.ts` 與 `src/lib/tribunal-v2/types.ts` 把 writer 範圍寫成「body + ShroomDogNote」：確認 writer 只原封保留既有的 ShroomDogNote、不新增也不改寫；若會，改成只改 body 並補測試（`editorial-charter`「自動化寫作 SHALL NOT 產生 ShroomDogNote」）
- [ ] 8.3 `docs/tribunal-runbook.md`：GP 只評分的理由改成正文是 ShroomDog 認可的版本，不提章

## 9. 文件

- [ ] 9.1 `CONTRIBUTING.md`：GP 例外改理由，加「升格要 PASS、之後重評不擋」；來源評估改成不分系列、預設 MP；〈新增 GP 導讀〉改寫成 GP 升格（上線前、上線後、降回 MP；升格不改內容契約；整篇翻譯規則適用所有系列）；MP 是日常文章；gp-pipeline `--prefix <MP|SD>`；GP 英文版條件同 MP；自動寫作一律不產生 `ShroomDogNote`
- [ ] 9.2 `GU-LOG_WRITER_PROMPT.md` 拿掉 GP 導讀寫法，GP／MP 寫法相同
- [ ] 9.3 `AGENTS.md`：路由表拿掉「GP 導讀」與「來源距離章與 `stamp`」；URL intake 短評一律建議 MP，GP 規則只指向 `gp-signature-picks`
- [ ] 9.4 其他把 GP 說成導讀或叫人蓋章的文件：`README.md`、`README.zh-TW.md`、`OBSIDIAN_SETUP.md`、`playbooks/CCC-playbook.md`、`scripts/mogu-picks-prompt.md`、`.agents/README.md`、`.agents/skills/gp-pipeline-sop/SKILL.md`、兩份 `x-source-fetch/SKILL.md`（`.claude/skills/level-up/`、`trim/` 是 dotfiles 鏡像，不在這裡改）
- [ ] 9.5 `docs/shroomdog-editorial-feedback.md` 加一筆 2026-10-28：GP／MP 從「寫法」改成「格」來分，GP 只聽 ShroomDog 指定
- [ ] 9.6 `rg -n "導讀|reading guide|reading-guide|來源距離|source-distance|stamp"` 掃上面這些文件，只剩確認過的命中

## 10. 整合與驗證

- [ ] 10.1 本機全綠：`pnpm run test:unit`、gp-pipeline `go test`、`scripts/tests/test-tribunal-model-router.sh`、`pnpm run validate:posts`、`pnpm run versions:check`、`pnpm run build`、第 6 組相關的 Playwright spec
- [ ] 10.2 Preview：GP-276～279 舊網址（含結尾斜線）308 到新 MP 網址；中英首頁沒有 GP 區；GP 系列頁回 200 並顯示空狀態；GP-1 照舊 200；新 MP 文章頁不出現「導讀 pipeline」。SSO 擋住就在 merge 後用 production 驗

## Workflow follow-up

- Archive 一律 sync，確認 `openspec/specs/source-distance-stamp/` 被刪掉；`openspec validate --specs --strict` 跟 main 比只少這一項，`node scripts/check-openspec-archive.mjs` 通過。
- Archive commit 手動改：`editorial-charter` 的 Purpose 拿掉「GP 導讀與來源之間的邊界」，GP 規則改指向 `gp-signature-picks`；Lv、MOBA 兩條 requirement 殘留的「GP 導讀」字樣改成中性說法（不改意思）；`gp-source-preservation` 的 Purpose 拿掉 ralph。
- Archive 後確認新建的 `openspec/specs/gp-signature-picks/spec.md` 帶的是 delta 裡的 Purpose，不是 placeholder。
- Merge 後在 production 重跑 10.2，回報 URL 與結果。
