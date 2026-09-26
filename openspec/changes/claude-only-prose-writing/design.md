# Design

## Context

gu-log 的文章由 Mogu 撰寫，Claude 是 Mogu 背後使用的 AI 模型。改動前，會產生或改寫文章字句的步驟分散在三套路由，各自使用不同模型：

| 路徑 | 步驟 | 改動前使用的模型 |
|---|---|---|
| gp-pipeline GP（VM `vm-codex` profile） | translator、commentary | Grok |
| gp-pipeline GP（VM） | corrector | Codex |
| gp-pipeline GP run 的英文 sidecar | 沿用 translator dispatcher | Grok |
| gp-pipeline MP write／refine、`translate` 子命令（VM） | writer | Grok |
| gp-pipeline 同上（本機／CCC） | `WritingChain` | Claude 優先；沒有 `claude` 退 Codex；`GP_WRITER_PROVIDER=codex` 強制 Codex |
| Tribunal 評審不過的改寫、final-build 修復 | `GP_WRITER_MODE` | unit 設 `grok`，wrapper 預設 `codex`，隔離候選交易只收 `codex`／`grok` |
| Tribunal v2（`src/lib/tribunal-v2`） | writer | 已是 `claude -p --agent tribunal-writer` |

判斷準則見 proposal：會產生或改寫讀者可見字句就算寫作步驟。GP source reviewer、natural-zh vibe gate、Tribunal 四位評審、eval 與 review 都只輸出判定或意見，維持原本的模型。

這個 change 推翻 2026-07-28 `codex-only-deployed-tribunal` 的決定。當時為了讓部署版只依賴 Codex、不綁 Claude 憑證，Tribunal VM 的評審與改寫全部改走 Codex（後來 VM profile 又改用 Grok 模型寫作）。依 owner 2026-09-26 的決定，改寫回到 Claude 模型，評審維持 Codex；代價是部署版同時依賴兩個供應端，取捨見〈Risks / Trade-offs〉。

限制條件：

- Claude 模型 pin 已有兩個互相對應的 SSOT：gp-pipeline 的 `ClaudeOpusPinned` 與 `.claude/agents/tribunal-writer.md` 的 `model:`。不能再造第三份。
- 既有 GP profile 規則要求 translator、corrector、vibe scorer 三個 model 互不相同；所有寫作步驟改用同一個 Claude 模型 pin 後，這條無法成立。
- 部署版 Tribunal 已有隔離候選交易、暫態 systemd service、寫入 canary 與 crash journal；換模型不能削弱這些邊界。
- VM 上原本的 Grok 寫作步驟有受限工具與 workspace sandbox，Codex corrector 是 read-only；直接換成預設的 `claude -p`（非 root 時 bypassPermissions、含 Bash）會讓被注入的來源拿到更大的權限。

## Goals / Non-Goals

**Goals:**

- 每一條文章寫作路徑都在 dispatch 邊界強制使用 Claude 模型，錯誤設定在呼叫模型前失敗。
- Model 只從既有 pin 讀取，Go 與 shell 兩邊在 runtime 交叉檢查並由測試守住漂移。
- 呼叫 Claude 模型撰寫文章時的權限不大於原本的 Grok／Codex 寫作步驟。
- 評審路徑不需要 Claude CLI 或憑證。

**Non-Goals:**

- 不改評審、eval、review、source reviewer、vibe gate 使用的模型。
- 不改 Claude 模型 pin 的世代，也不新增 Claude model ID。
- 不動 X 來源擷取腳本裡名稱帶 Grok 的 X API 參數；那些是 X 的 feature flag，不是 Grok 模型。
- 不為 Claude 額度建立新的 quota feed 或控制器。

## Decisions

### 1. 文章寫作步驟一律使用 Claude 模型，檢查放在 dispatch 邊界

哪些步驟算寫作只由 shell router（`scripts/tribunal-model-router.sh`）判定，而且雙向檢查：writer、translator、corrector、commentary 必須用 Claude，Claude 也只能用在這些步驟。Go 的 runtime routing 與 GP profile 都透過 router 解析，不另存一份步驟清單；GP profile 只另外拒絕 gate 評審使用 Claude 寫作 model。本機 `WritingChain` 只回 pin 住的 Claude 模型，`GP_WRITER_PROVIDER=codex` 明確報錯。Tribunal 的隔離候選交易只收 `GP_WRITER_MODE=claude`，`subagent`、`cli`、`codex`、`grok` 模式在任何模型呼叫前以「已退役」失敗（見第 9 點）；允許改寫但寫手模式不是 `claude` 時，在第一位評審前就以 rc 78 失敗，不先花評審額度。

替代方案是只改 `config/llm-pipeline.json`。那只擋得住 VM，擋不住本機 fallback 與 Tribunal writer mode，未來改 config 也能靜默回流，因此不採用。

### 2. Model 不進 config，runtime 交叉檢查兩個 SSOT

使用 Claude 的寫作步驟在 config 只宣告 `provider: claude` 與 prompt／output contract，不宣告 `model`、`reasoningEffort`（宣告了就視為錯誤）。Shell router 從 `.claude/agents/tribunal-writer.md` 解析 model（沿用 helpers 既有的嚴格 frontmatter parser，不另寫一份），Go 使用 `ClaudeOpusPinned`，並在建立 provider 時比對 router 回報的 model；不一致就封閉失敗。GP profile fingerprint 綁的是解析後的 pin，所以日後 owner 改 pin 時舊 manifest 自然失效。另加 Go 測試直接比對兩個 SSOT。

Claude 路徑沿用既有 Claude provider 的呼叫方式，不另外帶 effort 參數；因此 config 也不存 effort，以免來源紀錄宣稱一個沒有被使用的設定。

替代方案是在 config 寫死 pin 值再加測試同步。這會製造第三份副本，與 SSOT 紀律衝突，因此不採用。

### 3. GP 獨立性改成「寫作步驟 vs gate 評審」

原規則要 translator、corrector、vibe scorer 三個 model 不同。新規則：GP 寫作步驟（translator、corrector、commentary）共用 Claude 模型 pin；gate 評審（source reviewer、vibe scorer）的 model 必須和每一個寫作步驟都不同。Prompt／output contract 仍一步驟一份、不可共用。

原規則要防的是「寫的人替自己打分」與「失敗時偷偷換人」。前者由 gate 與寫作步驟使用不同 model 保證；corrector 只能依獨立 Codex gate 核准的 findings 產生局部 patch，並由 deterministic applicator 驗證 boundary，和 translator 同 model 不會讓它替自己的譯文背書；後者由 fail-closed routing 保證。替代方案是替 corrector 找另一個 Claude model，但使用者只允許既有 pin，因此不採用。

### 4. 最小權限的 Claude 呼叫

- GP translator、corrector、commentary 只回 JSON：不給任何工具，並用 Claude CLI 的 JSON schema 取得 structured output。原本 corrector 沒帶 schema，這次補上 bounded-patch 的傳輸層 schema；deterministic validator 仍是權威。
- MP write／refine、英文 sidecar：只給 Read、Grep、Glob、Edit、Write；讀取可涵蓋 repo，編修只在工作目錄內自動核准，沒有 Bash 與網路工具。
- Tribunal 改寫與寫入 canary：同樣的檔案工具與權限，cwd 是私有候選工作區；部署模式包進與評審相同規格的暫態 systemd service。Codex 與 Claude 的暫態 service 由同一個函式建立，各供應端要清掉的憑證變數也寫在同一處。
- 受限的 Claude 呼叫不載入主機的 user／project／local settings（權限規則、hooks、env）與 MCP server，主機設定不會放寬這次呼叫的權限。
- VM 上的 Claude CLI 只用 `claude auth login` 的登入狀態認證：暫態 service、Go 的受限呼叫與 router 的登入檢查都清掉 API key、改變計費端點（base URL、Bedrock／Vertex／Foundry／gateway 等供應端）與 `CLAUDE_CODE_OAUTH_TOKEN` 環境變數，避免計費靜默改走 API、其他端點或其他供應端的金鑰。清單只在 `scripts/tribunal-helpers.sh` 維護一份，Go 測試交叉比對 gp-pipeline 的副本。非部署版（開發機、CCC）的直接呼叫只清 API key，因為 CCC 本身靠 `ANTHROPIC_BASE_URL` 連 API。
- 永不使用 bypassPermissions。

實測 Claude CLI：這組參數下讀取 repo 外檔案成功、在 cwd 內寫檔成功、寫 cwd 外的檔案會立即被拒絕並列在 `permission_denials`，不會卡住。

GP run 的英文 sidecar 原本共用 translator dispatcher；translator 不再有檔案工具，所以 sidecar 改用 writer 路由。Sidecar 本來就不屬於 GP role profile，fingerprint 不受影響。

替代方案是讓所有 Claude 呼叫都拿檔案工具。那會讓被注入的來源有機會在 GP 工作目錄改寫 `source-tweet.md` 之類的證據檔，讓 source reviewer 對照被竄改的來源，因此不採用。

### 5. Provider preflight 以步驟為單位

需要 preflight 的供應端由各步驟設定的 provider 推導，config 不另列清單；原本的 `requiredProviders` 只是跟步驟設定各說各話的第二份來源，已刪除。解析某個步驟時，只檢查該步驟的供應端：Codex 查 CLI 與登入，Claude 查 CLI 登入狀態與模型 pin 能否解析。這樣評審解析不會呼叫 Claude CLI，也不會為了每次評審多花一個 Claude CLI 啟動時間。

部署 daemon 的寫入 canary 仍在領取文章前實際透過 Claude 模型寫一次；GP run 在任何文字變動前建立全部寫作步驟與 gate 的 dispatcher，兩條入口都在工作開始前封閉失敗。

### 6. 刪除 Grok 供應端

沒有步驟再使用 Grok，所以刪除 Grok 供應端：shell bridge、Go 的 Grok provider、router 的 Grok 分支，以及只為 Grok 寫作步驟存在的額度政策（`grokQuota` 與 router 裡 reserve／pause／defer 分支；該政策本來就因沒有可靠 quota feed 而停用）。`GP_WRITER_MODE=grok` 保留「已退役」錯誤，讓舊設定明確失敗。將來若要讓評審改用 Grok 模型，必須重新加回供應端並另開 change，不是改 config 就能切換。

### 7. Codex 寫作路徑退役

刪除用 Codex 模型改寫的 executor 與 Codex 寫入 canary。`.codex/agents/tribunal-writer.toml` 保留寫作契約文字（改寫 prompt 會引用），但移除 Codex `model`／effort 綁定，並寫明改寫只使用 Claude 模型，避免 Codex session 把它當成可用 Codex 模型執行的改寫工具。

### 8. Claude 額度與登入失效

控制器維持只讀 Codex 額度。Claude CLI 的錯誤分成額度與登入兩類；分類規則以目前 Claude CLI 實際輸出的訊息為回歸樣本，Go 與 shell 共用同一份樣本檔。Claude 以 `is_error` 回報的結果（包含結束碼為 0、`result` 為空、細節只在 `errors[]` 的情況）一律視為失敗並帶出 `errors[]`，讓分類認得出來。

- 額度：等待時間只取 Claude 回報的重置時間，無法解析時採保守預設（1 小時，可用 `GP_CLAUDE_QUOTA_DEFAULT_WAIT` 調整）；不執行 CodexBar，也不拿 Codex 的重置時間。Tribunal 改寫撞到額度時丟棄候選、還原文章、標記 `QUOTA_SUSPENDED`，不記評審失敗、不計改寫次數，並讓 daemon 暫停派送到重置時間，避免繼續評審其他文章又撞上同一個額度。
- 登入：丟棄候選、還原文章，worker 以 rc 78 結束；daemon 停止領新文章、排空進行中的 worker 後退出，並提示以跑 daemon 的使用者執行 `claude auth login`。不重評未改寫的文章，也不計失敗或改寫次數。
- 寫手 preflight 在領文章前失敗（例如未登入）時 daemon 直接退出，systemd 至少間隔 10 分鐘才重啟，不會每分鐘重試。

### 9. subagent 與舊版 cli 寫手模式退役

`subagent`（外層 session 透過 writer broker 接手改寫）與舊版 `cli`（開放 Bash 等工具、沒有受限參數的 `claude -p` 執行器）原本只保留給非部署版的互動式編排。隔離候選交易只收 `claude`，允許改寫時其他模式又會在第一位評審前失敗，這兩條路已經沒有可達入口，所以刪掉 writer broker、broker 的等待 helper 與舊版 `cli` 執行器，只留輸入驗證：退役模式集中列在 `tribunal_writer_mode_problem` 一處，寫手 preflight、改寫執行器、第一位評審前的檢查與 batch runner 都用它回「已退役」錯誤。非部署版的相容路徑只剩 CCC 評審在沒有 Codex 時的供應端備援，那條路不寫文章，不受影響。

## Risks / Trade-offs

- [風險] 背景改寫全部改用 Claude 模型，VM 上的 Claude 訂閱額度會被 Tribunal 與 GP pipeline 一起消耗，而控制器看不到 Claude 額度 → 額度錯誤以 unknown 暫停該篇，daemon 暫停派送到 Claude 回報的重置時間並保留可觀測紀錄；runbook 寫明控制器看不到 Claude 額度，必要時用 `--workers` 與停機控制用量。
- [取捨] 推翻 2026-07-28 的 Codex-only 部署：daemon 的評審用 Codex、寫作用 Claude，部署版從此同時依賴兩個供應端，Claude 登入失效或額度用完時改寫停下（fail closed），不退回 Codex → 寫入 canary、doctor live probe、額度暫停與登入失效停止領文章讓問題看得到；恢復靠 operator 重新登入或等額度重置。
- [風險] VM 的 Claude CLI 版本太舊，缺少受限呼叫需要的參數 → 部署 daemon 的寫入 canary 與 router preflight 會在領取文章前失敗；runbook 的部署步驟會跑 live probe 確認。
- [風險] VM 用環境變數 token 或 API key 認證 Claude → Tribunal 與 gp-pipeline 的 Claude 呼叫都會清掉這些變數，只認 `claude auth login` 的登入狀態，canary 會直接暴露這個問題。
- [取捨] systemd 的 `RestartSec` 拉長到 600 秒，也套用在寫手 preflight 以外的失敗重啟 → 任何失敗後最慢 10 分鐘才自動恢復；operator 修好後可以手動 restart。
- [取捨] Claude 額度訊息沒有重置時間時採 1 小時的保守預設 → 可能等太久或太短；等太短時下一次呼叫會再撞到額度並重新暫停，不會改用其他模型。
- [取捨] GP translator 與 corrector 共用同一個 model → 以獨立 Codex gate 核准 findings、patch boundary 驗證與 fail-closed routing 維持獨立性（見 Decision 3）。
- [取捨] GP natural-zh vibe gate 仍用 Codex 模型評 Claude 模型寫出的譯文 → 這正是寫作步驟與 gate 分離的要求；owner 只要求文章寫作改用 Claude 模型。
- [風險] 刪除 Codex／Grok 寫作路徑與 `subagent`、舊版 `cli` 寫手模式後，本機若仍設這些 `GP_WRITER_MODE` 值或 `GP_WRITER_PROVIDER=codex` 會直接失敗 → 錯誤訊息指出改用 Claude 模型的設定；只想評分的 run 可以用 `none` 或 `--no-rewrite`。

## Migration Plan

1. Merge 後在 Tribunal VM 以 tribunal 使用者安裝或更新 Claude Code CLI，執行 `claude auth login`，確認 `claude auth status` 回報已登入；不要改用 API key 或 OAuth token 環境變數認證。
2. 重新安裝受版控的 `tribunal-loop.service`（這次也改了 `RestartSec`），`systemctl --user daemon-reload` 後重啟；doctor 的 service contract 會比對檔案內容。
3. 跑 `bash scripts/cc-tribunal-loop-wrapper.sh --doctor --live-probe`，確認 Claude 寫入 canary 通過。
4. Grok CLI 可以移除，repo 已刪除 Grok 供應端。

回退：revert 這個 change 的 commits 並重新安裝 unit，即可回到 Grok／Codex 寫作路徑。
