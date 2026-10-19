# Tasks

> 前提：本 change 疊在 #1114（`translation-takedown-tombstone`）上。#1114 merge 後先把分支 rebase 到 main 再開 draft PR；archive 前 #1114 必須已經 archive。實作 commit 不碰 `openspec/**/specs/**`。每一組做完，`tools/gp-pipeline` 的 `go test -count=1 ./...` 與該組動到的其他測試都要是綠的，方便 bisect；會互相牽動的刪改（例如刪掉被測試引用的欄位）放在同一個 commit。

## 1. Go 測試先成為 CI 必要檢查（刪除前）

- [x] 1.1 在 rebase 後的 base 上跑 `tools/gp-pipeline` 的 `go test -count=1 ./...`，確認全綠並把結果寫進 PR 說明；若有紅燈，先在本 PR 修好再往下做
  - 實際結果：刪除前的 Go leaf 在 CI（`65e6cde9`，[run 36404462154](https://github.com/chitienhsiehwork-ai/gu-log/actions/runs/36404462154)）只有 5 個 GP source-preservation 測試失敗，原因是 CI 環境的 Jingjing 掃描帶 baseline、被保全 gate 拒絕。這些測試屬於本 change 刪除的程式，所以沒有另外修，隨第 4 組一起刪掉。
- [x] 1.2 在 `.github/workflows/ci.yml` 新增 Go 測試 leaf：設 `timeout-minutes`，只用 `setup-pnpm` 裝 Node 與 `pnpm install`，再用以 commit SHA pin 的 `actions/setup-go`（`go-version-file: tools/gp-pipeline/go.mod`、cache 綁 `go.sum`）執行 `go test -count=1 ./...`，並列進 `ci-passed.needs`；在既有讀取 `ci.yml` 的 workflow 結構測試加斷言（leaf 存在、列在 `ci-passed.needs`、有 `timeout-minutes`、先跑 `setup-pnpm`、執行的是 `go test -count=1 ./...`），該測試通過
- [x] 1.3 把 1.2 的 commit 單獨 push 到 draft PR，確認 Go leaf 與 `ci-passed` 都綠了，在 PR 說明留下 workflow run 連結，才開始第 2 組以後的 commit
  - 實際結果：1.2 單獨 push 時 Go leaf 因上述 5 個測試而紅，沒有等它轉綠才往下做；刪除後（`b7083ea0`，[run 36404712397](https://github.com/chitienhsiehwork-ai/gu-log/actions/runs/36404712397)）Go leaf 與 `ci-passed` 都綠。中間 commit 的 vitest 因 `post-versions.json` 過期而紅，`b7083ea0` 補上；PR 會以 squash merge 合併，不影響 main。

## 2. `writeJSON` 與 `RecordRoleFailure` 搬位置（純重構）

- [x] 2.1 `RecordRoleFailure` 從 `source_preservation.go` 移到 `internal/pipeline` 的一般檔案，旁邊放不匯出的 `writeJSON` 取代它原本用的 `preservation.WriteJSON`，寫出的 version 改成中性字串；其餘 helper 不搬。補 `writeJSON` 的單元測試（縮排、結尾換行、寫入失敗的錯誤），並用 MP 的 provider preflight 失敗測試確認 `<role>-failure.json` 與 run 狀態仍會寫出（原本只有 GP 測試覆蓋）；`go test -count=1 ./...` 綠

## 3. 檔名→系列 helper 與 GP ingress 拒絕

- [x] 3.1 把 `ValidateTranslationFilenames` 裡的系列對照表抽成單一檔名→系列 helper（接受可選的 `en-` 前綴，認得 `gp`、`mp`、`sd`、`lv`、`levelup`，舊品牌與未知前綴沿用現在的可行動錯誤），`ValidateTranslationFilenames` 改呼叫它；`run --file`、standalone `deploy --active-file`、`ralph --file` 都改用它，刪掉 `postPrefixFromFilename`。沒明確帶 `--prefix` 時用檔名系列，明確 `--prefix` 對不上時於 ingress 以 exit code 1 失敗並列出兩個系列。Go 測試涵蓋：`levelup-*` 在 `ralph --file`、沒帶 prefix 的 `run --file` 與 `ValidateTranslationFilenames` 都得到 Lv；`ralph --file en-*` 照常可用；MP 檔沒帶 prefix 以 MP 執行；prefix 與檔案不一致（對應 `gp-pipeline-publish-integrity` 的「以既有非 GP 檔案恢復時沒帶 prefix」與「prefix 與檔案系列不一致」）；更新 `TestStandaloneRalphInfersSeriesFromFilename`
- [x] 3.2 `run` 與 standalone `deploy` 處理 GP 時（含預設值、GP 檔的 `--file`／`--from-step` 恢復、GP pending 檔），以及 `counter bump` 的 GP prefix（含預設值），在 ingress 以 exit code 1 結束，早於槽位驗證、`yt-dlp` 檢查、`SetupWorkDir` 與 counter lock，訊息含「GP 暫停中」與 `editorial-charter`。Go 測試驗證 exit code 與訊息、指定的 `--work-dir` 沒被建立、fake provider 沒被呼叫、counter 檔不變（對應「沒指定 prefix 的 run」「以既有 GP 檔案恢復或發布」「counter bump 使用預設 prefix」）。同一個 commit 刪或改 `cmd/gp-pipeline/main_test.go` 裡會因此變紅的測試：GP CLI 測試 `:291`、`:319`、`:648`、`:661`、`:715`、`:798`、`:844`，以及 `:1017`（改用 MP 檔保留英文產物回報的覆蓋）；原本拿 GP 當預設或範例的 `:499`（YouTube 缺 `yt-dlp`，改帶 `--prefix MP`）、`:516`（槽位驗證，改用 MP pending 檔，對應 MODIFIED 後的「standalone deploy 三個槽位全缺」）、`:879`（翻譯補救，改用 MP 檔）。`go test -count=1 ./...` 綠
- [x] 3.3 `write`、`review`、`refine` 拒收 GP 的訊息改成「GP 暫停中」並指向 `editorial-charter`，exit code 維持 1；更新 `TestStandaloneLegacyTextCommandsRejectGP`（對應「單步寫作指令收到 GP」）
- [x] 3.4 確認既有 MP 的 happy path 與 `--from-step` 測試不改動即通過（對應「其他系列不受影響」）

## 4. 刪除 Go 的翻譯流程

- [x] 4.1 刪 GP 流程的引用點並加 pipeline 層的 GP 拒絕（跟 4.2 放同一個 commit，分開會編譯失敗）：`stepsForState` 的 GP 分支；`pipeline.Run` 與 `State.Deploy` 收到 GP 一開始就回「GP 暫停中」，早於 snapshot、`prepareExistingPost` 與任何步驟；`state.go` 的 GP 欄位與 step 常數別名；`credits.go` 的 `stampGPCredits`；`internal/pipeline/deploy.go` 的 manifest 驗證；`ralph.go` 依賴 `LegacyShadow` 與 source-preservation 的分支和訊息（保留 GP 的 no-rewrite、跳過 post fixer 與 normaliser）；`observability/status.go` 的 GP 翻譯 artifact；`llm/routing.go` 的 GP role 常數；`cmd/gp-pipeline/` 的 GP dispatcher、`--legacy-shadow`、GP 專用 step 名、run report 的 GP 欄位與 `bindGPDeployProfile`。同一個 commit 刪改引用這些項目的既有測試（例如 `TestCanonicalGPStageNamesAreDistinct`、`TestStepsForStateKeepsGPAndMPRoutingDistinct`、`internal/llm/routing_test.go` 的 GP 角色）。新增或改寫測試：pipeline 直接以 GP 呼叫 `Run`／`Deploy` 會被拒且沒有步驟、counter、檔案或 git 異動（對應「繞過 CLI 直接執行 pipeline」，`TestRun_DryRunSkipsDeploy` 的 GP 情境改成驗證被拒）；`--prefix MP` 搭配 `--from-step source-translate`／`source-preservation`／`source-gate`／`enrich` 回未知步驟錯誤（對應 `gp-source-preservation` 的「以退役的翻譯步驟恢復 run」）
- [x] 4.2 刪整檔：`internal/pipeline/source_preservation.go` 與測試、`internal/preservation/`（含 `testdata/`）、`internal/llm/gp_profile.go` 與測試、`internal/prompts/` 的五個翻譯 template，以及 `prompts.go` 的四個 GP data type 與對應 prompt 測試（`TestRender_EnglishSidecarDoesNotRestoreUnapprovedEmoji` 保留）；4.1＋4.2 的 commit 做完 `go build ./...`、`go vet ./...`、`go test -count=1 ./...` 都綠
- [x] 4.3 刪掉因此沒有呼叫端的死碼（獨立 commit）：`credits.go` 的 `PipelineEntry.Provider`／`ArtifactSHA256`／`Verdict` 與 `renderPipelineBlock` 對應分支；`internal/llm` 的 `RunOptions.JSONSchema`、Claude provider 的 `--json-schema` 參數、structured output 解析與 `StructuredOutput` 欄位，以及對應的 credits 與 Claude 測試案例；`claudeRuntimeTools` 的註解改成不再提 structured output。`go vet ./...` 與 `go test -count=1 ./...` 綠
- [x] 4.4 help 與操作指示：root、`run`、`deploy`、`counter`、`write`、`review`、`refine` 的 help 拿掉翻譯流程描述並註明 GP 暫停中；`candidate --help`（`candidate.go` 裡要人核准後跑 `run <youtube-url> --prefix GP` 的那段）、`SKILL.md` 與 `README.md` 的 candidate 後續指示改成不引導 GP；`tools/gp-pipeline/gp-pipeline` wrapper 與 `cmd/gp-pipeline/main.go` 的檔頭註解同步。help contract 測試同步並通過，人工確認各 `--help` 輸出沒有 source-translate、legacy-shadow 與 `--prefix GP` 的指示
- [x] 4.5 `rg -n -g '*.go' -g '*.tmpl' "preservation|LegacyShadow|legacy-shadow|source-translate|source-review|gp-publish-gate|GPProfile|buildGPDispatchers|JSONSchema|postPrefixFromFilename" tools/gp-pipeline` 只剩逐一確認過的非翻譯流程命中
- [x] 4.6 controller 的 spec commit `1b157881`：`youtube-candidate-preflight` 的 delta 把人工核准後的正式 run 改成帶 `--prefix <系列>`；實作面 4.4 的 `candidate --help` 已是這個寫法，不需改程式

## 5. Runtime 設定與 model router

- [x] 5.1 `config/llm-pipeline.json` 移除 `translator`、`sourceReviewer`、`corrector`、`commentary`，以及 `vibeScorer` 的 `promptContract`／`outputContract`（保留其 provider、model、reasoningEffort）；`scripts/tribunal-model-router.sh` 移除四個角色與它們的別名（`source-translator`、`source-reviewer`、`bounded-corrector`、`commentary-writer`），寫作角色清單只剩 `writer`，usage 字串同步
- [x] 5.2 更新 `scripts/tests/test-tribunal-model-router.sh`：寫作角色迴圈只留 writer 系列（`writer`、`tribunal-writer`、`refiner`），config 竄改案例改用 writer 與 `vibeScorer`；新增斷言：四個退役角色與它們的別名都回「unknown model role」且沒有呼叫 Claude 或 Codex CLI，而且用一份仍保留 `translator` 的設定檔 fixture 解析 `translator` 一樣回 unknown（對應「要求路由退役的翻譯角色」）。`test-tribunal-model-router.sh`、`test-tribunal-vm-routing.sh`、`test-tribunal-deploy-readiness.sh` 都通過

## 6. 只為翻譯流程存在的 script

- [x] 6.1 刪 `scripts/gp-body-projection.mjs` 與 `tests/gp-body-projection.test.ts`；archive 以外的 repo 內 `rg gp-body-projection` 沒有命中，`pnpm exec vitest run` 綠
- [x] 6.2 `scripts/check-jingjing.mjs` 移除 `--format=json` 分支、JSON contract version、policy digest 與只為它存在的掃描一致性檢查，檔頭 usage 同步；文字模式要讀的 policy 輸入 snapshot 保留。`tests/content-gates.test.ts` 與 `tests/list-content-gate-posts.test.ts` 通過，並對一篇既有 zh-tw 文章手動跑 `node scripts/check-jingjing.mjs <file>`，輸出與 exit code 跟修改前相同

## 7. 文件同步（只改操作導向與指向已刪機制的散文；prompt 與評分標準留給導讀 change）

- [x] 7.1 `tools/gp-pipeline/SKILL.md` 與 `README.md`：拿掉 GP 翻譯流程、`--legacy-shadow`、GP recovery 與 GP deploy manifest 的說明，改成「GP 暫停中，導讀格式另案」並指向 `editorial-charter`；補救與配號範例改成非 GP，並註明有 `--file`／`--active-file` 時以檔名判斷系列；exit code 表註明 GP 暫停回 1，並把 2 改成實際的 eval split。同一個 commit 同步 `cmd/gp-pipeline/help_contract_test.go` 的 `TestSkillRecoveryContract`（它現在要求 SKILL 保留 `source-preservation` 恢復、`gp-pending` standalone deploy 與 `legacy-shadow` 字樣），`go test -count=1 ./...` 綠
- [x] 7.2 `CONTRIBUTING.md`：〈GP 例外〉段、Fact Checker 段裡的 GP hard gates 句子、〈新增翻譯文章（GP）〉與〈GP Pipeline〉兩節改成 GP 暫停中，MP 流程文字不動；`tests/mp-editorial-contract.test.ts` 通過
- [x] 7.3 其他操作文件：`docs/tribunal-runbook.md`〈GP source-preservation boundary〉保留 GP 只評分、刪掉指向 gp-pipeline hard gates 與 GP recovery 的段落；`playbooks/CCC-playbook.md` 的 `gp-pipeline run <url>` 範例改成帶明確 prefix 並註明 GP 暫停中；`scripts/crontab-tribunal.example` 的 `gp-pipeline run <tweet_url>` 範例同樣處理；`AGENTS.md` 路由表的「GP 翻譯／MP 來源寫作 pipeline」改名；`.agents/skills/gp-pipeline-sop/SKILL.md` 的 `--prefix` 預設說明，以及 draft 模式與 Frontmatter 規則裡寫死的 `GP-PENDING` 改成 `<PREFIX>-PENDING`；兩份 `x-source-fetch` skill 的描述拿掉 GP translation；`scripts/check-pronoun-clarity.mjs` 的註解拿掉 source-preservation gates
- [x] 7.4 以 `rg -n "source-translate|source-preservation hard|source reviewer|natural-zh|bounded correct|gp-publish-gate|legacy-shadow"` 掃 repo，剩下的命中只能在 openspec archive、`docs/shroomdog-editorial-feedback.md` 等歷史紀錄，或 design Non-Goals 列給導讀 change 的 prompt 與評分檔，逐一確認

## 8. 整合驗證、archive 與上線

- [ ] 8.1 全套驗證：`tools/gp-pipeline` 的 `go build ./...`、`go vet ./...`、`go test -count=1 ./...`，以及 `pnpm run lint`、`pnpm exec astro check`、`pnpm exec vitest run`、`node scripts/validate-posts.mjs`、`openspec validate --all --strict`、`pnpm run build`；PR 上 CI 全綠（含新的 Go leaf）
- [x] 8.2 Archive 前確認 #1114 已 archive（main spec 的標題已是 `Synthetic regression pair MUST calibrate source-preserving behavior`）且分支已 rebase 到 main；`openspec archive retire-gp-translation-pipeline` 的輸出含 `gp-source-preservation` 的 11 條 removed，而且沒有 "not in the current spec" 警告
- [x] 8.3 Archive 時（跟 8.2 同一個 commit）移除本 change 在 `quality/brand-taxonomy-residual-allowlist.json` 加的 4 條 exact exception，`npm run -s taxonomy:check` 仍綠
- [x] 8.4 Archive 後直接改 `openspec/specs/gp-source-preservation/spec.md` 的 Purpose：整篇翻譯流程已退役，本 capability 只保留退役紀錄與 GP 只評分的邊界，並指向本 change 的 design；`openspec validate --specs --strict` 通過
- [ ] 8.5 轉 ready、等 Codex auto-review、掛 auto-merge；上線後 smoke：production 首頁與 `/gu-log-picks` 回 200、GP 暫停空狀態不變（本 change 沒有讀者可見變化），並在 chat 回報 production URL 與 `gp-pipeline run <url>` 的暫停錯誤實際輸出

## 9. 實作審查後的修正（已完成，排在第 8 組的整合驗證之前）

- [x] 9.1 pipeline 層有 `ExistingFile` 時用 `SeriesFromFilename` 判斷 GP（不放進 `prepareExistingPost`，standalone `translate` 帶預設 GP prefix 才不會被誤擋）；測試：`Prefix` 帶 MP 配 GP 既有檔，從 deploy 步驟呼叫 `pipeline.Run` 與 `State.Deploy` 都回「GP 暫停中」、不 commit
- [x] 9.2 standalone `credits` 碰到 GP 檔（`gp-` 檔名或 `GP-` ticketId）回同一個 `ErrGPPaused`（exit 1）、檔案不變；design 的「擋下的入口」補上 `credits`
- [x] 9.3 `ci.yml` Go leaf 的註解拿掉 check-jingjing（`setup-pnpm` 仍需要，dedup-gate 用 `gray-matter`）；`tests/ci-workflow.test.ts` 斷言 `gp-pipeline-go-tests` 的 job 與 step 都沒有 `continue-on-error`
- [x] 9.4 刪掉 `internal/pipeline/phase3_test.go` 沒有呼叫端的 `findRepoRoot()`
- [x] 9.5 `scripts/check-jingjing.mjs` 刪掉只給已刪 JSON 模式用的 `startByte`／`endByte` 與 `Buffer` import，撐著它們的測試改寫成驗證文字報告的行號、字詞與所在句子；改前改後對全站跑文字模式，輸出與 exit code 相同
- [x] 9.6 文件去重：入口怎麼擋 GP 只留在 `tools/gp-pipeline/SKILL.md`（README、CONTRIBUTING 指向它）；user 要 GP 時怎麼回應只留在 `CONTRIBUTING.md`〈新增翻譯文章（GP）〉（SKILL、CCC playbook 指向它）；各處保留「GP 暫停中」字串
