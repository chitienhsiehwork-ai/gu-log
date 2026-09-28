# Design

## Context

動機見 proposal.md。以下只記錄影響做法的現況（以 #1114 分支 HEAD `bb23cf80` 的 code 為準）：

- **GP 與 MP 的分流**：`internal/pipeline/run.go` 的 `stepsForState` 在 prefix 是 GP、且沒有 `--legacy-shadow` 時，走 `source-translate → source-preservation → enrich → credits → ralph → translate → deploy`；MP、SD、Lv 走 `write → review → refine → credits → ralph → translate → deploy`。GP 生產流程的五個角色由 `buildGPDispatchers` 建立，並由 `LoadGPProfile` 從 `config/llm-pipeline.json` 的 `vm-codex` profile 驗證。
- **暫停狀態**：#1114 以 `src/lib/gp-series-pause.mjs` 的 `GP_SERIES_PAUSED` 暫停 GP，下架棘輪在 pre-commit 與 CI 擋新增的 GP 文章；gp-pipeline 本身沒有任何暫停判斷。`run`、standalone `deploy`、`write`、`counter bump`／`next` 的 `--prefix` 預設都是 GP，`review`／`refine` 的 `--ticket-id` 預設是 `GP-PENDING`。
- **Prefix 與檔案的關係**：`run --file` 恢復時，`prepareExistingPost` 用檔名驗證 ticket，但 `stepsForState` 用的是 `--prefix`（預設 GP），兩者沒有互相比對；所以沒帶 `--prefix MP` 的 MP 補救指令今天會走進 GP 分支，在 GP role profile 的 preflight 或 `source-translate` 的恢復檢查失敗。檔名→系列的判斷目前有兩套：`ValidateTranslationFilenames` 認得 `levelup-`（既有 Lv 文章 17 篇全是 `levelup-*`，沒有 `lv-*`）但拒收 `en-` 檔；standalone `ralph` 用的 `postPrefixFromFilename` 接受 `en-` 檔卻不認得 `levelup-`，所以 `ralph --file levelup-*` 現在就會失敗。
- **既有的 ingress 拒絕**：非 canonical prefix、`write`／`review`／`refine` 拒收 GP，都在 ingress 回 plain error，exit code 1。`tools/gp-pipeline/SKILL.md` 把 2 寫成「CLI 用法錯誤」，但 code 實際只有 eval split 回 2（`run` 與 `eval` 都是），文件已經 drift。
- **Go 測試**：CI 與 git hook 都沒跑。部分測試會呼叫 repo 的 Node 腳本與套件（`dedup-gate`、`check-jingjing`，以及需要 `@mdx-js/mdx` 的 `gp-body-projection`）；其中有的在找不到 `node` 時 `t.Skip`，有的直接失敗。Proposer 在 `bb23cf80` 本機（Go 1.24.7、Node 22、已裝 `node_modules`）跑 `go test ./...`，18 個 package 全綠。
- **Router 的共用角色**：`scripts/tribunal-model-router.sh` 把 Tribunal 的 `vibe-opus-scorer` 對到 `vibeScorer`，所以 VM 上的 Tribunal Vibe 評審與 GP 的自然中文 gate 共用同一個設定角色；`scripts/tests/test-tribunal-vm-routing.sh` 也讀它的 model。`translator`、`sourceReviewer`、`corrector`、`commentary` 只有 GP 翻譯流程在用。
- **GP 只評分的邊界**：`scripts/tribunal.sh` 對 `gp-*`／`en-gp-*` 強制只評分，並拒絕明確的 `--allow-rewrite`；gp-pipeline `ralph` 對 GP 用 no-rewrite、跳過會改正文的 post fixer。這條行為目前唯一的 spec 家是 `gp-source-preservation` 的「GP rebuild prohibition」。

## Goals / Non-Goals

**Goals:**

- 刪掉只為 GP 整篇翻譯存在的程式、設定、script 與規格，讓導讀 change 從乾淨的 base 開始。
- 刪除之前，gp-pipeline 的 Go 測試先成為 `ci-passed` 的必要 leaf。
- 暫停期間會為 GP 產生新文章或配置 GP 號碼的入口都在 ingress 失敗，不燒額度、不留工作目錄；pipeline 層再擋一次。
- MP 與 Tribunal（含 VM 的 Vibe 評審路由）行為不變。

**Non-Goals:**

- 不改 GP 的編輯定義與餵給線上模型的文字：`editorial-charter` 的 GP 身份與 GP 正文 requirement、`GU-LOG_WRITER_PROMPT.md`、`scripts/vibe-scoring-standard.md`、`.claude/agents/` 的評審檔、`write`／`review`／`refine` prompt 裡的 GP 分支。這些由導讀 change 一次改成導讀契約，避免 prompt 改兩輪；暫停期間 Tribunal 範圍內的 GP 只剩自寫示範文 GP-1，裡面指向已刪機制的舊句子不會造成錯誤行為。
- 不改 Tribunal 與 `ralph` 對 GP 只評分的程式。
- 不動網站、文章、`GP_SERIES_PAUSED` 與下架棘輪；不改 `--prefix` 預設值。
- 不處理 VM 上的舊版 binary（#1114 已排給 owner，延到導讀上線後）。

## Decisions

### 1. Go 測試先上，而且是獨立的 CI leaf

新增一個設有 `timeout-minutes` 的 leaf job：checkout → `./.github/actions/setup-pnpm`（Go 測試只需要 Node 與 `pnpm install` 裝好的 repo 套件，不裝其他相依）→ `actions/setup-go`（照 repo 慣例 pin commit SHA，`go-version-file: tools/gp-pipeline/go.mod`，cache 綁 `tools/gp-pipeline/go.sum`）→ 在 `tools/gp-pipeline` 跑 `go test -count=1 ./...`（停用測試快取，避免 cache 命中讓依賴 repo 腳本的測試沒有真的重跑），並列進 `ci-passed.needs`。這些設定寫成斷言，加進既有讀取 `ci.yml` 的 workflow 結構測試，不為一個 job 另開測試檔。

這個 commit 先單獨 push，draft PR 上看到 Go leaf 綠了才開始刪，讓「刪除前是綠的」有 CI 證據，而不只是本機結果。

替代方案是把 Go 測試塞進既有的 `unit-tests` job。不採用：Vitest 與 Go 的失敗會混在一起、共用 10 分鐘上限，leaf 也無法直接對應 spec 的「Go 測試 leaf」。

### 2. 刪除邊界：只有 GP 生產流程會走到、或只有它在用的才刪

判斷方法是從 `stepsForState` 的 GP 分支、`buildGPDispatchers`、`LoadGPProfile` 往下追呼叫端；只要有 MP 或 Tribunal 的呼叫端就保留。

| 區塊 | 刪除 |
|---|---|
| Go 整檔 | `internal/pipeline/source_preservation.go` 與測試；`internal/preservation/` 整個 package（含 `testdata/`）；`internal/llm/gp_profile.go` 與測試；`internal/prompts/` 的 `source-translate`、`source-review`、`correct`、`commentary`、`vibe-gate` 五個 template |
| Go 局部 | `cmd/gp-pipeline/`：`run.go` 的 GP dispatcher、`--legacy-shadow`、GP 專用 step 名與 run report 的 `gpProfile`／`gateManifest`／`roleRuns`；`llm_helper.go` 的 GP 角色與 `buildGPDispatchers`／`buildFakeGPDispatchers`；`deploy.go` 的 manifest 要求與 `bindGPDeployProfile`。`internal/pipeline/`：`run.go`、`state.go`、`credits.go`、`deploy.go`、`ralph.go` 的 GP 分支與只給 GP 用的欄位（GP dispatcher、`LegacyShadow`、`GPProfile*`、`CanonicalTerminology`、`GateManifestPath`、`RoleRun(s)`、`stampGPCredits`）；step 常數改回不經 GP 別名。`internal/observability/status.go` 的 GP 翻譯 artifact 清單；`internal/llm/routing.go` 的五個 GP runtime role；`internal/prompts/prompts.go` 的四個 GP data type。對應測試一併刪改 |
| 設定與 router | `config/llm-pipeline.json` 的 `translator`、`sourceReviewer`、`corrector`、`commentary`，以及 `vibeScorer` 身上只給 `LoadGPProfile` 讀的 `promptContract`／`outputContract`；`scripts/tribunal-model-router.sh` 的四個 role key、寫作角色清單與 usage 字串；`scripts/tests/test-tribunal-model-router.sh` |
| Script | `scripts/gp-body-projection.mjs` 與 `tests/gp-body-projection.test.ts`；`scripts/check-jingjing.mjs` 的 `--format=json` 分支與只為它存在的 policy digest（文字模式仍要讀的 policy 輸入 snapshot 保留） |
| 刪完才變成的死碼 | `internal/pipeline/credits.go` 的 `PipelineEntry.Provider`／`ArtifactSHA256`／`Verdict` 與 `renderPipelineBlock` 對應的輸出分支（只有 `stampGPCredits` 會填）；`internal/llm` 的 `RunOptions.JSONSchema`，以及 Claude provider 的 `--json-schema` 參數、structured output 解析與對應測試（只有 GP 的 JSON 角色會傳 schema）；`cmd/gp-pipeline/ralph.go` 的 `postPrefixFromFilename`（改用共用的檔名→系列 helper，見決策 3） |

保留：MP 共用的 `write`／`review`／`refine`／`credits`／`ralph`／`translate`／`deploy`；英文 sidecar 的 `translate.tmpl`；`vibeScorer` 的 model 路由；`internal/terminology`；Tribunal 的 GP 只評分；Go 端 `claudeRuntimeTools` 對非 writer 角色不給工具的預設（註解改成不再提 structured output）。

### 3. GP 暫停：在 ingress 拒絕，exit code 1

- **擋下的入口**：`run` 與 standalone `deploy` 處理 GP 時、`counter bump` 的 GP prefix、`write` 的 GP prefix、`review`／`refine` 的 GP ticket（都含預設值）。它們在 prefix／ticket 驗證之後立刻判斷 GP，早於 `SetupWorkDir`、YouTube 的 `yt-dlp` 檢查、檔名槽位驗證、runtime profile 解析、provider preflight 與 counter lock，所以不會留下工作目錄或呼叫任何外部程式。standalone `credits` 蓋章會改寫 frontmatter，碰到 GP 檔（`gp-` 檔名或 `GP-` ticketId）同樣以 exit 1「GP 暫停中」結束，早於 scratch 目錄與任何寫檔。
- **不擋的入口**：`counter next` 唯讀；`ralph` 只評分（對 GP 仍是 no-rewrite）；`translate` 只替已經存在的文章補英文檔，不會產生新 GP 文章或號碼，而下架文章的英文墓碑另有棘輪保護；`fetch`、`eval`、`dedup`、`candidate`、`status`、`doctor` 不產生文章。
- **pipeline 層再擋一次**：`pipeline.Run` 與 `State.Deploy` 收到 GP 時一開始就回「GP 暫停中」，早於 observability snapshot、`prepareExistingPost` 與任何步驟。有既有檔（`ExistingFile`）時跟 CLI 一樣由檔名決定系列，`Prefix` 只管新文章，所以 `Prefix` 跟檔案對不上也帶不過 GP；這個判斷不放進 `prepareExistingPost`，因為 standalone `translate` 會帶著預設的 GP prefix 呼叫它。這要跟刪除 `stepsForState` 的 GP 分支放在同一個 commit：GP 分支一刪，GP 的 `State` 就會掉進 MP 的 `write → review → refine` 路徑，只靠 CLI 入口擋太薄。`NewState` 的預設 prefix 仍是 GP，所以忘了設 prefix 的呼叫端會明確失敗，不會靜默跑成別的系列。
- **以文章判斷是不是 GP，而且只有一套判斷**：把 `ValidateTranslationFilenames` 裡的系列對照表抽成單一的檔名→系列 helper（接受可選的 `en-` 前綴，認得 `gp`、`mp`、`sd`、`lv`、`levelup`；舊品牌與未知前綴沿用現在的可行動錯誤），`ValidateTranslationFilenames` 改呼叫它，`run --file`、standalone `deploy --active-file`、`ralph --file` 都用它，`postPrefixFromFilename` 刪掉。`ValidateTranslationFilenames` 本身不能直接拿來用，因為它拒收 `ralph` 需要的 `en-` 檔。沒明確帶 `--prefix` 就用檔名系列，明確帶了但對不上就在 ingress 以 exit code 1 失敗、訊息列出兩個系列（用 cobra 的 `Flags().Changed` 分辨「明確指定」與「預設值」）；沒有檔案時才用 `--prefix`。這只取檔名第一段的系列，跟「standalone deploy 不得從 pending 檔名反推 date／author／title 槽位」的規則不衝突：系列段沒有邊界歧義，槽位才有。不這樣做的話，MP 與 Lv 的補救指令會收到誤導的「GP 暫停中」，spec 裡「recovery guidance」要求的 `run --from-step translate --file <existing>.mdx` 也無法照寫照跑；順帶修好 `ralph --file levelup-*`。
- **既有情境的範例**：`gp-pipeline-publish-integrity`「standalone deploy 缺檔名槽位」的第一個情境用 GP pending 檔當範例，要求錯誤訊息指名缺少的 flag；GP 拒絕排在槽位驗證之前，所以範例改成 MP pending 檔，「run pipeline 不受影響」情境也明寫 `--prefix MP`（MODIFIED），槽位規則本身不變。
- **Exit code 1**：跟既有 ingress 拒絕一致（非 canonical prefix、`write`／`review`／`refine` 拒 GP，`candidate` 的輸入錯誤也是 1）。不選 2，因為 2 已同時被文件說成「CLI 用法錯誤」、被 code 用在 eval split；也不新開一個 code，19 預留給導讀 change 的來源距離失敗，暫停只是過渡狀態。自動化以錯誤訊息裡固定的「GP 暫停中」辨識。`--json` 模式跟其他 ingress 拒絕一樣不輸出 run report。
- **訊息**：英文說明加上「GP 暫停中」與 `openspec: editorial-charter`，口徑跟下架棘輪的訊息一致。訊息不引導改用 MP：系列要依 reader job 與 voice ownership 選（`editorial-charter`），不該由錯誤訊息替 agent 換系列。
- **`--prefix` 預設維持 GP**。改成預設 MP 會讓沒帶 prefix 的舊指令靜默產出 MP，把系列選擇藏進預設值；改成必填是 CLI 契約變動，導讀上線後大概又要改回。維持預設 GP，舊指令會明確失敗，導讀上線後自然恢復。
- **不讀 `GP_SERIES_PAUSED`**：Go 端的拒絕反映的是「pipeline 裡已經沒有 GP 流程」這個結構事實，不是暫停旗標的副本。導讀 change 會同時加回 GP 流程、關掉旗標；兩邊若沒一起改，結果只會多擋（ingress 或棘輪其中之一擋下），不會漏放。

### 4. `--legacy-shadow` 一起刪

它唯一的用途是拿舊的 GP editorial flow 跟 source-translate 並排比較，比較對象不在了。導讀 change 要走的 `write → review → refine` 是 MP 的一般路徑，不需要這個 flag。

### 5. Helper：只留 `writeJSON`，不開新 package

- `internal/preservation/` 的 helper 裡，刪除後只有 `WriteJSON` 還有 production 呼叫端（`RecordRoleFailure`）。它改成 `internal/pipeline` 裡不匯出的 `writeJSON`，跟 `RecordRoleFailure` 放在同一個一般檔案，並補單元測試（縮排、結尾換行、寫入失敗的錯誤）。
- `RecordRoleFailure` 留在 `internal/pipeline`（`run` 的 preflight 失敗會用），寫出的 JSON 改用中性 version 字串；現在的 `gp-source-preservation/v1` 沒有任何讀取端。
- `DecodeStrict`、`SHA256`、`Provenance`、`ValidateProvenance`、attempt 編號跟著 package 刪除。導讀 change 若需要，再從 git 歷史拿回（各不到 30 行）。
- 替代方案是把這幾個 helper 搬進新的小 package 留給導讀 change。不採用：2a 之後它們沒有呼叫端，只能靠為了保留而補的測試撐著，是先寫給未來的程式。

### 6. `internal/terminology` 原地保留

2a 之後它沒有 production 呼叫端，只剩自己的測試；留給導讀 change 接到寫手，不搬、不改。

### 7. Spec：退役紀錄 + 保留仍在執行的邊界

- `gp-source-preservation` 比照 2026-09-26 `codex-exec-writing-runtime` 的退役做法：REMOVED 所有翻譯流程 requirement，ADDED 一條「維持退役」紀錄，想恢復的人必須先改 spec。Archive 時由 controller 直接改 main spec 的 Purpose（delta 改不到 Purpose），同樣比照前例。
- 「GP rebuild prohibition」用 MODIFIED 留下，拿掉對 source translation 與 bounded correction 的依賴。理由：Context 列的只評分行為 2a 不動、導讀 change 也確定保留（GP 在 Tribunal 只打分、不改正文，是章不會過期的前提），整條刪掉會讓仍在執行的行為失去 spec。`tribunal.sh` 的錯誤訊息「GP source-preservation contract forbids --allow-rewrite」因此仍然正確，不用改。REMOVED 的「GP corrections」裡「低 vibe 分數不得觸發 GP 重建」情境搬進這條。
- `claude-prose-writing-runtime`：「Mogu 撰寫與改寫文章 SHALL 一律使用 Claude 模型」用 MODIFIED 拿掉已刪步驟。最小權限 requirement 裡「只回傳 JSON 的寫作步驟不給工具、用 structured output 取 JSON」的條文與情境，對象隨翻譯流程消失，structured output 路徑也列為死碼刪除；OpenSpec 不允許 MODIFIED 丟掉既有情境（validate 與 archive 都會擋），所以舊名 REMOVED，其餘條文與兩個情境原樣以「Claude 寫作呼叫 SHALL 以最小權限執行並擷取乾淨輸出」ADDED，輸出擷取條文拿掉 structured output 字眼。
- 英文 sidecar 的 emoji 規則移到 `editorial-charter` 的 emoji requirement：sidecar 是 MP 共用的，規則不能跟著 GP spec 一起消失。`TestRender_EnglishSidecarDoesNotRestoreUnapprovedEmoji` 保留；若 `translate.tmpl` 的 "automated GP sidecar lane" 字樣改寫，測試同步。
- **導讀 change 要接回的不變式**（寫在這裡，避免看起來像被悄悄拿掉）：
  1. **把關角色不得與寫手共用 model**：以「aligner pin ≠ writer pin」重新寫回（pin 放 `.claude/agents/source-aligner.md` 的 `model:`，router 的 aligner role 讀它，測試鎖住）。2a 期間沒有任何 GP gate 角色，GP 在 ingress 就被拒絕，沒有可以鑽的空窗。
  2. **寫手收到 canonical glossary 術語 context**：接上保留的 `internal/terminology`。
  3. **正文投影**：導讀的章需要自己的投影與固定指紋測試，不沿用 `gp-body-projection.mjs`。
  4. **Claude 評審的最小權限與路由**：`claude-prose-writing-runtime` 只管寫作步驟，router 目前也禁止評審使用 Claude；aligner 若用 Claude，導讀 change 要自己定義它的路由與工具權限。Claude 的 JSON schema／structured output 支援在 2a 刪除，aligner 需要時從 git 歷史拿回。
  5. **GP-273 的自然中文反例**：`internal/preservation/contracts.go`（`DeterministicNaturalFindings`）裡的「銜尾蛇」「演算法動態」，以及同樣出現在翻譯與 vibe-gate prompt 的說明，刪除後沒有任何 live SSOT，只剩 archive 裡的舊 spec。要不要寫進 writer prompt、評分標準或導讀的檢查，由導讀 change 決定。
  6. **Tribunal v2 的 GP 不可改寫防護**：`pnpm tribunal:run`（`scripts/tribunal-v2-run.ts`）的評審→寫手迴圈目前沒有 GP 只評分的判斷，不像 `tribunal.sh` 會對 `gp-*` 強制 no-rewrite。這是既有缺口、不是 2a 造成；暫停期間在 Tribunal 範圍內的 GP 只剩 GP-1，但導讀上線後「GP 在 Tribunal 只打分」是章不會過期的前提，導讀 change 要補上。

### 8. Router 與 runtime 設定

- `vibeScorer` 保留 model 路由（Tribunal 在用），只拿掉 GP 專用的 contract 欄位。
- 四個翻譯角色連同別名（`source-translator`、`source-reviewer`、`bounded-corrector`、`commentary-writer`）從 router 的 role key 移除，照 router 既有行為以「unknown model role」回 2；因為判斷發生在讀設定檔之前，設定檔就算還留著 `translator` 也一樣是未知角色。寫作角色清單只剩 `writer`，「寫作步驟 ⇔ Claude」的雙向檢查不變。
- Go 端 `claudeRuntimeTools` 對非 writer 角色不給工具的預設保留，當作 fail-closed 預設。

### 9. `ralph` 對 GP 的處理

保留 no-rewrite、跳過 post fixer 與跳過 pipeline 戳記 normaliser（GP 只評分、只寫分數）；只刪依賴 `LegacyShadow` 與 source-preservation 的分支和訊息（例如 "source-preservation gates remain authoritative"）。暫停期間 `run` 走不到 GP 的 `ralph`，只剩 standalone `ralph --file gp-*`（例如 GP-1）會用到。Standalone `ralph` 改用決策 3 的共用檔名→系列 helper，`levelup-*` 的 Lv 文章因此可以跑。

### 10. 文件的切法

操作導向的文件，以及指向已刪機制的說明，在 2a 更新（清單見 tasks）；餵模型的 prompt 與評分標準留給導讀 change（見 Non-Goals）。SKILL.md 的 exit code 表順手收斂 Context 提到的 drift：2 實際是 eval split。

## Risks / Trade-offs

- [Go leaf 在 CI 缺依賴而失敗，或依賴 Node 的測試被略過] → leaf 先跑 `setup-pnpm`；workflow 結構測試鎖住；刪除前先確認 leaf 綠。
- [刪 router 角色誤傷 VM 上的 Tribunal] → `vibeScorer` 保留；跑 router 測試、`test-tribunal-vm-routing.sh` 與 `test-tribunal-deploy-readiness.sh`。
- [`check-jingjing.mjs` 刪 JSON 分支時波及文字模式] → 文字模式要讀的 policy 輸入 snapshot 保留；以 `tests/content-gates.test.ts` 與 pre-commit 的晶晶體檢查驗證。
- [沒帶 prefix 的舊指令與文件] → 錯誤訊息講清楚；CCC playbook、SKILL、CONTRIBUTING、gp-pipeline-sop 的範例同步改。
- [以檔名推系列改變既有行為] → 只在沒明確帶 `--prefix` 時生效；原本這條路徑對非 GP 檔本來就會失敗，沒有依賴它的正確用法。明確帶錯的 `--prefix` 從「跑到一半才失敗」變成 ingress 失敗。
- [VM 上的舊 binary 仍有翻譯流程] → VM 更新延到導讀上線後（#1114 已排給 owner）；舊 VM 產出的 GP 會被棘輪擋在 PR。
- [#1114 尚未 merge] → 本 change 疊在 #1114 上：開 PR 前先 rebase 到 main；archive 前確認 #1114 已 archive。實測 OpenSpec 找不到 REMOVED 標題時只給 warning 並當成已刪除，所以若順序顛倒，`Synthetic regression pair…` 這條會靜默留在 main spec。
- [pipeline 層擋 GP 讓依賴 `NewState` 預設 prefix 的測試失敗] → 這些測試在同一個 commit 明確改帶非 GP prefix，或改成驗證 GP 被拒。
- [Revert 2a] → 翻譯流程的程式回來，但 GP 仍被暫停旗標與棘輪擋下，不會發布。

## Migration Plan

照 tasks 的順序做 atomic commit：CI leaf（單獨 push 等綠）→ `writeJSON` 與 `RecordRoleFailure` 搬位置（純重構）→ 共用檔名→系列 helper 與 GP ingress 拒絕（此後 CLI 走不到 GP 流程）→ 刪 Go 翻譯流程並加 pipeline 層的 GP 拒絕 → 刪死碼 → 設定與 router → script → 文件 → archive。每一組做完都讓 `go test -count=1 ./...` 與受影響的測試維持綠色，方便 bisect。

Rollback：revert 整個 PR。沒有資料遷移；網站與文章不受影響。
