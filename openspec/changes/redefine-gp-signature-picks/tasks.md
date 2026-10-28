# Tasks

> - 實作 commit 不碰 `openspec/**/specs/**`；不改 spec 做不下去就停手回報 controller。
> - 一個 commit 一件事。每組做完 `pnpm run test:unit` 要綠，動到 `tools/gp-pipeline` 再跑 `go build ./... && go vet ./... && go test -count=1 ./...`。測試只驗行為與結構化的值，不比對 prompt 原句。
> - 順序：第 1 組最先。3.4 刪 `scripts/source-distance.mjs` 與 `scripts/lib/source-distance.mjs`，要排在第 2 組、4.3、4.4 之後，或跟 4.3 放同一個 commit（Go 的 source-distance 步驟與 `doctor` 會呼叫那支 script）。第 7 組等第 2～5 組完成。
> - 升格門檻是 publish bar（`publish-bar-visibility`，實作是 `src/utils/tribunal-scores.ts` 的 `meetsPublishBar`）：`scripts/reclassify-post.mjs` 升格前檢查，5.4 的 pre-commit／CI 檢查只看這次新變成 GP 的檔案；已經是 GP 的檔案重評沒過不擋。

## 1. 共用 helper 搬家

- [x] 1.1 `isExternalSource`（含它用到的網域判斷）從 `scripts/lib/source-distance.mjs` 搬到 `scripts/lib/external-source.mjs`，呼叫端改 import，測試搬到 `tests/external-source.test.ts`

## 2. 下架來源一律擋（`post-takedown`）

- [x] 2.1 `scripts/dedup-gate.mjs` 拿掉「GP 只撞到下架 GP 回 WARN」的例外，一律 BLOCK；`tests/dedup-gate.test.ts` 同步（〈自動化 SHALL 依狀態處理下架文章〉）
- [x] 2.2 `tools/gp-pipeline/internal/dedup/` 與 `cmd/gp-pipeline/dedup.go` 的註解、help、測試同步改成 BLOCK
- [x] 2.3 `scripts/check-takedown-ratchet.mjs`：拿掉驗章例外；遷移清單有記、`sourceUrl` 沒變的改系列不算新增；改系列文章之後補上缺少的語言版本不算新增，`--staged` 與 `--base` 都要成立。`scripts/hooks/pre-commit` 註解與 `tests/takedown-ratchet.test.ts` 同步（〈已下架文章與它們的來源 SHALL 被 CI 棘輪鎖住〉）

## 3. 退役來源距離章（`source-distance-stamp`）

- [x] 3.1 同一個 commit：刪 `scripts/validate-posts.mjs` 的 Rule 1.6、GP-276～279 六個檔的 `sourceDistance`、`src/content.config.ts` 的欄位、`scripts/lib/taken-down-posts.mjs` 的對應項；schema 拒絕帶 `sourceDistance` 的文章，測試同步（`post-takedown`「下架文章留著來源距離章」）
- [x] 3.2 `scripts/check-translation-pairs.mjs` 拿掉 `englishSkipped` 與 GP 專屬判斷，GP 併進 `PAIRED_PREFIXES`；`tests/translation-pairs.test.ts` 同步
- [x] 3.3 `scripts/hooks/pre-commit` 刪驗章區塊；`tests/hooks-integration.test.ts`、`tests/helpers/pre-commit-repo.ts` 同步
- [x] 3.4 刪 `scripts/source-distance.mjs`、`scripts/lib/source-distance.mjs`、`tests/source-distance.test.ts`、`tests/helpers/source-distance-stamp.ts`，同一個 commit 改掉還 import 它們的測試（順序見檔頭）
- [x] 3.5 `scripts/take-down-posts.mjs`、`scripts/inject-related-posts.mjs`、`vercel.mjs` 提到章或導讀的註解改掉
- [ ] 3.6 `rg -n "sourceDistance|source-distance|englishSkipped|verifyStamp|writeStamp|requiresStamp"`（排除 `openspec/`、`tools/gp-pipeline/`）只剩確認過的命中，寫進 PR 說明

## 4. gp-pipeline 不寫 GP、不配 GP 號（`gp-pipeline-publish-integrity`）

- [x] 4.1 把 GP 加進既有的 Lv 拒絕（`internal/pipeline/authoring.go`），在任何副作用前擋下 `run`、`write`、`review`、`refine`、`ralph` 處理 GP；錯誤訊息依系列指路（GP 指向 `--prefix MP` 與上線後升格）。`counter bump --prefix GP` 與替 `GP-PENDING` 配號的 `deploy`（含 `run` 的 deploy 步驟）也拒絕。新增 `cmd/gp-pipeline/gp_refusal_test.go`（改名後擋 Lv 與 GP 的四條要求）
- [x] 4.2 GP 仍可用的步驟（`dedup`、`translate`、`credits`、`run --file <已配號的 GP 檔> --from-step translate|deploy`）照常，缺的測試補上
- [x] 4.3 同一個 commit 刪導讀分支：`run.go`、`state.go` 的 GP 步驟與欄位，`ralph.go` 的 GP 分支，`guide.go`（`containsShroomDogNote`、`rejectShroomDogNote` 搬到 `internal/pipeline/shroomdognote.go`），`sourcedistance.go`、`cmd/gp-pipeline/stamp.go`、`internal/llm/aligner.go`、`align.tmpl`，write／review／refine／translate 模板的 GP 分支，`eval-codex.tmpl`、`eval-gemini.tmpl` 的 GP 導讀分支，`internal/pipeline/eval.go` 的「GP-worthy」訊息改成不分系列，`translate.go` 的逐字檢查；測試同步（「以退役的 source-distance 步驟恢復」）
- [x] 4.4 移除 aligner 角色：`internal/llm/` 的 routing 與 dispatcher、`cmd/gp-pipeline/llm_helper.go`、`doctor.go`、`config/llm-pipeline.json`、`scripts/tribunal-model-router.sh`、`.claude/agents/source-aligner.md`、`scripts/crontab-tribunal.example`；`scripts/tests/test-tribunal-model-router.sh` 加 `aligner` 回 unknown role
- [x] 4.5 `shroomdognote.go` 拿掉 GP 限定，`write`、`refine` 對每個系列都檢查（exit 14）；「不得寫 `ShroomDogNote`」的 prompt 規則與 review 檢查移到共用段落；補 MP、SD 的 Go 測試（〈寫作步驟 SHALL 拒絕含 `ShroomDogNote` 的模型輸出〉）
- [x] 4.6 help 與錯誤訊息只把 MP、SD 列為可撰寫系列；`counter`、`deploy` 的說明寫明 GP 號只由 `scripts/reclassify-post.mjs` 配出，`dedup` 照舊列 GP；`help_contract_test.go`、`lv_refusal_test.go` 同步（〈寫作指令的說明與錯誤訊息 SHALL NOT 邀請撰寫 Lv 或 GP〉）
- [x] 4.7 `tools/gp-pipeline/SKILL.md`、`README.md` 拿掉導讀、來源距離、`stamp`；寫明 pipeline 不寫 GP、不配 GP 號，GP 只由已上線的 MP 升格，任何系列輸出 `ShroomDogNote` 都 exit 14
- [x] 4.8 `rg` 掃 `tools/gp-pipeline` 的 `SourceDistance|sourceDistance|source-distance|Aligner|aligner|EnglishCheck|englishSkipped|guide|GP-worthy|ShroomDogNote|Terminology`，只剩確認過的命中，寫進 PR 說明

## 5. 改系列指令與升格把關（`gp-signature-picks`）

- [x] 5.1 新增 `scripts/reclassify-post.mjs <ticketId> <GP|MP>`，只處理已上線的 GP、MP：全部拒絕條件（含 `PENDING`、升 GP 沒通過 `meetsPublishBar`，分數用 `yaml` 解析）先檢查完才動手；配號、`git mv`、遷移清單（`counts` 用 `vercel.mjs` 的 `deriveManifestCounts`）、連結（符合 pre-commit 的 link-only 規則）與 counter；最後跑 `validate-posts`（〈改系列 SHALL 只用一支指令，兩種語言一起搬〉〈改系列 SHALL 在動手前拒絕不合法的移動〉）
- [x] 5.2 `tests/reclassify-post.test.ts`：在暫存 git repo 跑真的 script，涵蓋上面兩條 requirement 的情境（含拒絕 `MP-PENDING`、`GP-PENDING`）
- [ ] 5.3 `scripts/allocate-ticket.mjs` 拒絕 GP，測試同步（〈GP MUST 由已上線的 MP 升格而來〉）
- [ ] 5.4 新增 `scripts/check-gp-promotion.mjs`（`--staged`、`--base=<sha>`）：新變成 GP 的檔案要通過 `meetsPublishBar`、`gp-pending-` 檔一律失敗、基準版本已是 GP 的檔案不檢查、取不到基準就失敗；接進 `scripts/hooks/pre-commit` 與 `.github/workflows/ci.yml`（加進 `ci-passed.needs`），補測試，含「既有 GP 寫回較低的分數」照樣通過（〈新變成 GP 的檔案 SHALL 在 pre-commit 與 CI 通過 publish bar〉）

## 6. 首頁、列表與讀者文案（`gp-signature-picks`〈GP 列表…〉；`brand-taxonomy`〈Reader-facing series labels…〉）

- [ ] 6.1 `src/lib/gp-listing.mjs` 改說明與空狀態文案，`tests/tombstone-copy.test.ts` 同步
- [ ] 6.2 `src/pages/index.astro`、`src/pages/en/index.astro`：只在至少有一篇過 publish bar 的 GP 時輸出 GP `<section>`，刪掉用不到的空狀態元素與樣式；副標改成招牌文章；GP 卡片的「原文：」／`Original:` 改成跟 MP 卡片一樣的「來源材料」／`Source material:`
- [ ] 6.3 `src/pages/gu-log-picks/[...page].astro`、`src/pages/en/gu-log-picks/[...page].astro`：副標與卡片的來源標示同 6.2
- [ ] 6.4 `src/pages/posts/[...slug].astro`、`src/pages/en/posts/[...slug].astro`：GP 跟 MP 一樣顯示「來源材料」／`Source material`；`src/components/ArticleTechnicalDetails.astro` 刪 `reading-guide` 模式
- [ ] 6.5 `src/pages/about.astro`、`src/pages/en/about.astro`、`scripts/article-counter.json` 的系列說明改成 MP 日常、GP 招牌，刪來源距離章段落
- [ ] 6.6 測試：`tests/helpers/gp-listing.ts` 的 `expectGpHomeBlock` 處理沒有 GP 區；`tests/mp-editorial-identity.spec.ts` 的 About 與 GP-1 斷言；`tests/spec-ownership.json` 兩筆 reason 拿掉「reading guides」「reading-guide」的說法；`.github/workflows/deploy-smoke-test.yml` 與 `tests/deploy-smoke-workflow.test.ts` 不提導讀
- [ ] 6.7 視覺改動跑雙主題截圖檢查（Claude Code 用 `uiux-auditor`）

## 7. 清理 GP-276～279（`gp-signature-picks`、`brand-taxonomy`、`post-takedown`）

- [ ] 7.1 一個 commit：照 `node scripts/check-pronoun-clarity.mjs` 的提示，最小修改 GP-276（約第 112、114 行）與 GP-278（約第 90 行）被標出的三句；GP-278 中英標題拿掉「導讀」／"A Reading Guide to" 的字樣，其他不動
- [ ] 7.2 `scripts/check-pronoun-clarity.mjs` 拿掉 GP 豁免（`isGPPost` 與註解），測試同步
- [ ] 7.3 依號碼順序對 GP-276～279 各跑 `node scripts/reclassify-post.mjs GP-<n> MP`，每篇一個 commit，訊息寫舊號與新號（共 6 個檔）。GP-276、277 只有繁中、Tribunal 沒過，這次不補英文版，照繁中優先 SOP 等以 MP 過了 Tribunal 再補
- [ ] 7.4 確認：
  - GP counter 不動、MP 前進 4；四個新 MP ticket 的檔案正確（原 276、277 只有繁中，原 278、279 中英都有），舊 GP 檔都不在；
  - `check-takedown-ratchet --base=origin/main`、`check-gp-promotion --base=origin/main`、`check-translation-pairs --strict --pr-base=main`（main 上不帶 `--pr-base` 本來就是紅的）、`check-brand-taxonomy`、`validate-posts --check-duplicates`、`versions:check`（不過就重建兩份 version manifest 一起 commit）、`tests/vercel-routing-config.test.ts` 都綠
- [ ] 7.5 `.github/workflows/deploy-smoke-test.yml` 加原 GP-278 中英網址 308 到新 MP 網址

## 8. Tribunal 與評審指示（`gp-source-preservation`、`tribunal-focal-source-evidence`、`tribunal-score-persistence`）

- [ ] 8.1 `scripts/tribunal.sh` 拒絕 GP `--allow-rewrite` 的訊息與 `src/lib/tribunal-v2/pipeline.ts` 的註解不再提章；`tests/tribunal-gp-score-only.test.ts`、`tests/tribunal-v2/pipeline.test.ts` 照舊綠
- [ ] 8.2 `.claude/agents/` 與 `.codex/agents/` 的 fact-checker、fresh-eyes、librarian、tribunal-writer、vibe-opus-scorer，以及 `scripts/vibe-scoring-standard.md`：GP 跟 MP 同一套規則，`ShroomDogNote` 歸給 ShroomDog 的規則適用所有系列，不改 model pin（「評審讀到 ShroomDogNote」）
- [ ] 8.2a `src/lib/tribunal-v2/runners/stage-runners.ts` 與 `src/lib/tribunal-v2/types.ts` 把 writer 範圍寫成「body + ShroomDogNote」：確認 writer 只原封保留既有的 ShroomDogNote、不新增也不改寫；若會，改成只改 body 並補測試（`editorial-charter`「自動化寫作 SHALL NOT 產生 ShroomDogNote」）
- [ ] 8.3 `docs/tribunal-runbook.md`：GP 只評分的理由改成正文是 ShroomDog 認可的版本，不提章

## 9. 文件

- [ ] 9.1 `CONTRIBUTING.md`：GP 例外改理由，加「升格要通過 publish bar、之後重評不擋」；來源評估改成不分系列、預設 MP；〈新增 GP 導讀〉改寫成 GP 升格（只從已上線的 MP 升格、降回 MP；升格不改內容契約；整篇翻譯規則適用所有系列）；MP 是日常文章；gp-pipeline `--prefix <MP|SD>`；GP 英文版條件同 MP；自動寫作一律不產生 `ShroomDogNote`
- [ ] 9.2 `GU-LOG_WRITER_PROMPT.md` 拿掉 GP 導讀寫法，GP／MP 寫法相同
- [ ] 9.3 `AGENTS.md`：路由表拿掉「GP 導讀」與「來源距離章與 `stamp`」；URL intake 短評一律建議 MP，GP 規則只指向 `gp-signature-picks`
- [ ] 9.4 其他把 GP 說成導讀或叫人蓋章的文件：`README.md`、`README.zh-TW.md`、`OBSIDIAN_SETUP.md`、`playbooks/CCC-playbook.md`、`scripts/mogu-picks-prompt.md`、`.agents/README.md`、`.agents/skills/gp-pipeline-sop/SKILL.md`、兩份 `x-source-fetch/SKILL.md`（`.claude/skills/level-up/`、`trim/` 是 dotfiles 鏡像，不在這裡改）
- [ ] 9.5 `docs/shroomdog-editorial-feedback.md` 加一筆 2026-10-28：GP／MP 從「寫法」改成「格」來分，GP 只聽 ShroomDog 指定
- [ ] 9.6 `rg -n "導讀|reading guide|reading-guide|來源距離|source-distance|stamp"` 掃上面這些文件，只剩確認過的命中

## 10. 整合與驗證

- [ ] 10.1 本機全綠：`pnpm run test:unit`、gp-pipeline `go test`、`scripts/tests/test-tribunal-model-router.sh`、`pnpm run validate:posts`、`pnpm run versions:check`、`pnpm run build`、第 6 組相關的 Playwright spec
- [ ] 10.2 Preview：GP-276～279 舊網址（含結尾斜線）308 到新 MP 網址；中英首頁沒有 GP 區；GP 系列頁回 200 並顯示空狀態；GP-1 照舊 200；新 MP 文章頁不出現「導讀 pipeline」。SSO 擋住就在 merge 後用 production 驗

## Workflow follow-up

- Archive 一律 sync，確認 `openspec/specs/source-distance-stamp/` 被刪掉、新建的 `openspec/specs/gp-signature-picks/spec.md` 帶的是 delta 裡的 Purpose；`openspec validate --specs --strict` 跟 main 比只少 `source-distance-stamp`、多一個通過的 `gp-signature-picks`，`node scripts/check-openspec-archive.mjs` 通過。
- Sync 不會改 Purpose，archive commit 手動改：`editorial-charter` 的 Purpose 拿掉「GP 導讀與來源之間的邊界」，GP 規則改指向 `gp-signature-picks`；`gp-source-preservation` 的 Purpose 拿掉 ralph。
- Merge 後在 production 重跑 10.2，回報 URL 與結果。
