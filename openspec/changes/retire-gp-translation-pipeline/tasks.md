# Tasks

> 前提：本 change 疊在 #1114（`translation-takedown-tombstone`）上。#1114 merge 後先把分支 rebase 到 main 再開 draft PR；archive 前 #1114 必須已經 archive。實作 commit 不碰 `openspec/**/specs/**`；每組結束時 `tools/gp-pipeline` 的 `go test ./...` 都要是綠的，方便 bisect。

## 1. Go 測試先成為 CI 必要檢查（刪除前）

- [ ] 1.1 在 rebase 後的 base 上跑 `tools/gp-pipeline` 的 `go test ./...`，確認全綠並把結果寫進 PR 說明；若有紅燈，先在本 PR 修好再往下做
- [ ] 1.2 在 `.github/workflows/ci.yml` 新增 Go 測試 leaf（`setup-pnpm` → 以 commit SHA pin 的 `actions/setup-go`，`go-version-file: tools/gp-pipeline/go.mod`、cache 綁 `go.sum` → `go test ./...`），列進 `ci-passed.needs`；新增 Vitest workflow 結構測試，鎖住 leaf 存在、列在 `ci-passed.needs`、先跑 `setup-pnpm`、執行的是 `go test ./...`，該測試通過
- [ ] 1.3 把 1.2 的 commit 單獨 push 到 draft PR，確認 Go leaf 與 `ci-passed` 都綠了，在 PR 說明留下 workflow run 連結，才開始第 2 組以後的 commit

## 2. Helper 搬家（純重構，不改行為）

- [ ] 2.1 新增 `internal/artifact`，搬入 `WriteJSON`、`DecodeStrict`、`SHA256`、`Provenance` 與 `ValidateProvenance`、attempt 編號（改成通用名稱），錯誤訊息改中性字眼；補單元測試（拒絕未知欄位與尾端資料、JSON 縮排與結尾換行、attempt 檔名解析與非法編號報錯、provenance 缺欄位報錯）；原呼叫端改用新 package，`go test ./...` 綠
- [ ] 2.2 `RecordRoleFailure` 從 `source_preservation.go` 移到 `internal/pipeline` 的一般檔案，version 改成中性字串；用 MP 的 provider preflight 失敗測試確認 `<role>-failure.json` 與 run 狀態仍會寫出（原本只有 GP 測試覆蓋時補一個），`go test ./...` 綠

## 3. GP 暫停：ingress 拒絕

- [ ] 3.1 把 `ralph.go` 的 `postPrefixFromFilename` 抽成共用 helper；`run --file` 與 standalone `deploy --active-file` 在沒有明確 `--prefix` 時改用檔名系列，明確 `--prefix` 對不上時於 ingress 以 exit code 1 失敗並列出兩個系列；Go 測試涵蓋「MP 檔沒帶 prefix 照常以 MP 執行」與「prefix 與檔案不一致」（對應 `gp-pipeline-publish-integrity` 的同名情境）
- [ ] 3.2 `run` 與 standalone `deploy` 判定為 GP 時（含預設值、GP 檔的 `--file`／`--from-step` 恢復、GP pending 檔）於 ingress 以 exit code 1 結束，早於槽位驗證、`yt-dlp` 檢查與 `SetupWorkDir`，訊息含「GP 暫停中」與 `editorial-charter`；Go 測試驗證 exit code 與訊息、指定的 `--work-dir` 沒被建立、fake provider 沒被呼叫、counter 檔不變（對應「沒指定 prefix 的 run」與「以既有 GP 檔案恢復或發布」）
- [ ] 3.3 `write`、`review`、`refine` 拒收 GP 的訊息改成「GP 暫停中」並指向 `editorial-charter`，exit code 維持 1；更新 `TestStandaloneLegacyTextCommandsRejectGP`（對應「單步寫作指令收到 GP」）
- [ ] 3.4 既有 MP 的 happy path 與 `--from-step` 測試不改動即通過（對應「其他系列不受影響」）；原本拿 GP 當預設或當範例的非 GP 行為測試改用 MP 檔或 MP prefix，例如 `TestDeployDryRunValidatesFilenameSlots`（改用 MP pending 檔，對應 MODIFIED 後的「standalone deploy 三個槽位全缺」）、`TestCanonicalRunYouTubeMissingYTDLPFailsBeforeProviderSetup`、`TestRunCommand_FromStepTranslateDryRunReportsSidecarAndSkipsGitMutations`；`go test ./...` 綠

## 4. 刪除 Go 的翻譯流程

- [ ] 4.1 刪整檔：`internal/pipeline/source_preservation.go` 與測試、`internal/preservation/`（含 `testdata/`）、`internal/llm/gp_profile.go` 與測試、`internal/prompts/` 的五個翻譯 template，以及 `prompts.go` 的四個 GP data type 與對應 prompt 測試（`TestRender_EnglishSidecarDoesNotRestoreUnapprovedEmoji` 保留）；`go build ./...`、`go vet ./...`、`go test ./...` 都綠
- [ ] 4.2 刪局部：`stepsForState` 的 GP 分支、`state.go` 的 GP 欄位與 step 常數別名、`credits.go` 的 `stampGPCredits`、`internal/pipeline/deploy.go` 的 manifest 驗證、`ralph.go` 依賴 `LegacyShadow` 與 source-preservation 的分支和訊息（保留 GP 的 no-rewrite、跳過 post fixer 與 normaliser）、`observability/status.go` 的 GP 翻譯 artifact、`llm/routing.go` 的 GP role 常數，以及 `cmd/gp-pipeline/` 的 GP dispatcher、`--legacy-shadow`、GP 專用 step 名、run report 的 GP 欄位與 `bindGPDeployProfile`；刪改對應測試，並新增 `--prefix MP` 搭配 `--from-step source-translate`／`source-preservation`／`source-gate`／`enrich` 回未知步驟錯誤的測試（對應 `gp-source-preservation` 的「以退役的翻譯步驟恢復 run」），`go test ./...` 綠
- [ ] 4.3 root、`run`、`deploy`、`write`、`review`、`refine` 的 help 拿掉翻譯流程描述並註明 GP 暫停中；`tools/gp-pipeline/gp-pipeline` wrapper 與 `cmd/gp-pipeline/main.go` 的檔頭註解同步；help contract 測試同步並通過，人工確認各 `--help` 輸出沒有 source-translate 與 legacy-shadow 字樣
- [ ] 4.4 `rg -n "preservation|LegacyShadow|legacy-shadow|source-translate|source-review|gp-publish-gate|GPProfile|buildGPDispatchers" tools/gp-pipeline` 只剩逐一確認過的非翻譯流程命中

## 5. Runtime 設定與 model router

- [ ] 5.1 `config/llm-pipeline.json` 移除 `translator`、`sourceReviewer`、`corrector`、`commentary`，以及 `vibeScorer` 的 `promptContract`／`outputContract`（保留其 provider、model、reasoningEffort）；`scripts/tribunal-model-router.sh` 移除四個 role key，寫作角色清單只剩 `writer`，usage 字串同步
- [ ] 5.2 更新 `scripts/tests/test-tribunal-model-router.sh`：寫作角色迴圈只留 writer 系列（`writer`、`tribunal-writer`、`refiner`），config 竄改案例改用 writer 與 `vibeScorer`，並新增四個退役角色都回「unknown model role」、且沒有呼叫 Claude 或 Codex CLI 的斷言（對應「要求路由退役的翻譯角色」）；`test-tribunal-model-router.sh`、`test-tribunal-vm-routing.sh`、`test-tribunal-deploy-readiness.sh` 都通過

## 6. 只為翻譯流程存在的 script

- [ ] 6.1 刪 `scripts/gp-body-projection.mjs` 與 `tests/gp-body-projection.test.ts`；archive 以外的 repo 內 `rg gp-body-projection` 沒有命中，`pnpm exec vitest run` 綠
- [ ] 6.2 `scripts/check-jingjing.mjs` 移除 `--format=json` 分支、JSON contract version、policy digest 與只為它存在的掃描一致性檢查，檔頭 usage 同步；文字模式要讀的 policy 輸入 snapshot 保留。`tests/content-gates.test.ts` 與 `tests/list-content-gate-posts.test.ts` 通過，並對一篇既有 zh-tw 文章手動跑 `node scripts/check-jingjing.mjs <file>`，輸出與 exit code 跟修改前相同

## 7. 文件同步（只改操作導向與指向已刪機制的散文；prompt 與評分標準留給導讀 change）

- [ ] 7.1 `tools/gp-pipeline/SKILL.md` 與 `README.md`：拿掉 GP 翻譯流程、`--legacy-shadow`、GP recovery 與 GP deploy manifest 的說明，改成「GP 暫停中，導讀格式另案」並指向 `editorial-charter`；exit code 表註明 GP 暫停回 1，並把 2 改成實際的 eval split；pre-commit 的文件檢查通過
- [ ] 7.2 `CONTRIBUTING.md`：〈GP 例外〉段、Fact Checker 段裡的 GP hard gates 句子、〈新增翻譯文章（GP）〉與〈GP Pipeline〉兩節改成 GP 暫停中，MP 流程文字不動；`tests/mp-editorial-contract.test.ts` 通過
- [ ] 7.3 其他操作文件：`docs/tribunal-runbook.md`〈GP source-preservation boundary〉保留 GP 只評分、刪掉指向 gp-pipeline hard gates 與 GP recovery 的段落；`playbooks/CCC-playbook.md` 的 `gp-pipeline run <url>` 範例改成帶明確 prefix 並註明 GP 暫停中；`AGENTS.md` 路由表的「GP 翻譯／MP 來源寫作 pipeline」改名；`.agents/skills/gp-pipeline-sop/SKILL.md` 的 `--prefix` 預設說明；兩份 `x-source-fetch` skill 的描述拿掉 GP translation；`scripts/check-pronoun-clarity.mjs` 的註解拿掉 source-preservation gates
- [ ] 7.4 以 `rg -n "source-translate|source-preservation hard|source reviewer|natural-zh|bounded correct|gp-publish-gate|legacy-shadow"` 掃 repo，剩下的命中只能在 openspec archive、`docs/shroomdog-editorial-feedback.md` 等歷史紀錄，或 design Non-Goals 列給導讀 change 的 prompt 與評分檔，逐一確認

## 8. 整合驗證、archive 與上線

- [ ] 8.1 全套驗證：`tools/gp-pipeline` 的 `go build ./...`、`go vet ./...`、`go test ./...`，以及 `pnpm run lint`、`pnpm exec astro check`、`pnpm exec vitest run`、`node scripts/validate-posts.mjs`、`openspec validate --all --strict`、`pnpm run build`；PR 上 CI 全綠（含新的 Go leaf）
- [ ] 8.2 Archive 前確認 #1114 已 archive（main spec 的標題已是 `Synthetic regression pair MUST calibrate source-preserving behavior`）且分支已 rebase 到 main；`openspec archive retire-gp-translation-pipeline` 的輸出是 11 條 removed，而且沒有 "not in the current spec" 警告
- [ ] 8.3 Archive 後直接改 `openspec/specs/gp-source-preservation/spec.md` 的 Purpose：整篇翻譯流程已退役，本 capability 只保留退役紀錄與 GP 只評分的邊界，並指向本 change 的 design；`openspec validate --specs --strict` 通過
- [ ] 8.4 轉 ready、等 Codex auto-review、掛 auto-merge；上線後 smoke：production 首頁與 `/gu-log-picks` 回 200、GP 暫停空狀態不變（本 change 沒有讀者可見變化），並在 chat 回報 production URL 與 `gp-pipeline run <url>` 的暫停錯誤實際輸出
