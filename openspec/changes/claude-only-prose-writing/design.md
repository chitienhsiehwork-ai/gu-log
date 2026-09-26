# Design

## Context

改動前，文章寫作角色分散在三套路由，各自有不同的供應端：

| 路徑 | 角色 | 改動前 |
|---|---|---|
| gp-pipeline GP（VM `vm-codex` profile） | translator、commentary | Grok |
| gp-pipeline GP（VM） | corrector | Codex |
| gp-pipeline GP run 的英文 sidecar | 沿用 translator dispatcher | Grok |
| gp-pipeline MP write／refine、`translate` 子命令（VM） | writer | Grok |
| gp-pipeline 同上（本機／CCC） | `WritingChain` | Claude 優先；沒有 `claude` 退 Codex；`GP_WRITER_PROVIDER=codex` 強制 Codex |
| Tribunal 評審不過的改寫、final-build 修復 | `GP_WRITER_MODE` | unit 設 `grok`，wrapper 預設 `codex`，隔離候選交易只收 `codex`／`grok` |
| Tribunal v2（`src/lib/tribunal-v2`） | writer | 已是 `claude -p --agent tribunal-writer` |

判斷角色的準則見 proposal：會產生或改寫讀者可見字句就算寫作角色。GP source reviewer、natural-zh vibe gate、Tribunal 四位評審、eval 與 review 都只輸出判定或意見，維持原狀。

限制條件：

- Claude 寫手 model 已有兩個互相對應的 SSOT：gp-pipeline 的 `ClaudeOpusPinned` 與 `.claude/agents/tribunal-writer.md` 的 `model:`。不能再造第三份。
- 既有 GP profile 規則要求 translator、corrector、vibe scorer 三個 model 互不相同；所有寫作角色改用同一個 pin 後，這條無法成立。
- 部署版 Tribunal 已有隔離候選交易、暫態 systemd service、寫入 canary 與 crash journal；換寫手不能削弱這些邊界。
- VM 上的 Grok 寫手原本有受限工具與 workspace sandbox，Codex corrector 是 read-only；直接換成預設的 `claude -p`（非 root 時 bypassPermissions、含 Bash）會讓被注入的來源拿到更大的權限。

## Goals / Non-Goals

**Goals:**

- 每一條寫作路徑都在 dispatch 邊界強制 Claude，錯誤設定在呼叫 model 前失敗。
- Model 只從既有 pin 讀取，Go 與 shell 兩邊在 runtime 交叉檢查並由測試守住漂移。
- Claude 寫作呼叫的權限不大於原本的 Grok／Codex 寫手。
- 評審路徑不需要 Claude CLI 或憑證。

**Non-Goals:**

- 不改評審、eval、review、source reviewer、vibe gate 的供應端或 model。
- 不改 Claude pin 的世代，也不新增 Claude model ID。
- 不移除 Grok 的 provider 程式碼；它只是不再擔任任何角色。
- 不為 Claude 額度建立新的 quota feed 或控制器。

## Decisions

### 1. 寫作角色一律 Claude，檢查放在 dispatch 邊界

Go 的 runtime routing 對 writer、translator、corrector、commentary 只接受 Claude provider；shell router 對同一組角色做一樣的檢查；GP profile 載入要求三個 GP 寫作角色都是 Claude。本機 `WritingChain` 只回 pin 住的 Claude 寫手，`GP_WRITER_PROVIDER=codex` 明確報錯。Tribunal 的隔離候選交易只收 `GP_WRITER_MODE=claude`，`codex`／`grok` 模式在任何 model 呼叫前以「已退役」失敗。

替代方案是只改 `config/llm-pipeline.json`。那只擋得住 VM，擋不住本機 fallback 與 Tribunal writer mode，未來改 config 也能靜默回流，因此不採用。

### 2. Model 不進 config，runtime 交叉檢查兩個 SSOT

Claude 寫作角色在 config 只宣告 `provider: claude` 與 prompt／output contract，不宣告 `model`、`reasoningEffort`（宣告了就視為錯誤）。Shell router 從 `.claude/agents/tribunal-writer.md` 解析 model（沿用 helpers 既有的嚴格 frontmatter parser，不另寫一份），Go 使用 `ClaudeOpusPinned`，並在建立 provider 時比對 router 回報的 model；不一致就封閉失敗。GP profile fingerprint 綁的是解析後的 pin，所以日後 owner 改 pin 時舊 manifest 自然失效。另加 Go 測試直接比對兩個 SSOT。

Claude 路徑沿用既有 Claude provider 的呼叫方式，不另外帶 effort 參數；因此 config 也不存 effort，以免來源紀錄宣稱一個沒有被使用的設定。

替代方案是在 config 寫死 pin 值再加測試同步。這會製造第三份副本，與 SSOT 紀律衝突，因此不採用。

### 3. GP 角色獨立性改成「寫作 vs gate」

原規則要 translator、corrector、vibe scorer 三個 model 不同。新規則：GP 寫作角色（translator、corrector、commentary）共用 Claude pin；gate 角色（source reviewer、vibe scorer）的 model 必須和每一個寫作角色都不同。Prompt／output contract 仍一角色一份、不可共用。

原規則要防的是「寫的人替自己打分」與「失敗時偷偷換人」。前者由 gate 與寫作不同 model 保證；corrector 只能依獨立 Codex gate 核准的 findings 產生局部 patch，並由 deterministic applicator 驗證 boundary，和 translator 同 model 不會讓它替自己的譯文背書；後者由 fail-closed routing 保證。替代方案是替 corrector 找另一個 Claude model，但使用者只允許既有 pin，因此不採用。

### 4. 最小權限的 Claude 呼叫

- GP translator、corrector、commentary 只回 JSON：不給任何工具，並用 Claude CLI 的 JSON schema 取得 structured output。原本 corrector 沒帶 schema，這次補上 bounded-patch 的傳輸層 schema；deterministic validator 仍是權威。
- MP write／refine、英文 sidecar：只給 Read、Grep、Glob、Edit、Write；讀取可涵蓋 repo，編修只在工作目錄內自動核准，沒有 Bash 與網路工具。
- Tribunal 寫手與寫入 canary：同樣的檔案工具與權限，cwd 是私有候選工作區；部署模式包進與評審相同規格的暫態 systemd service，並移除 API key 類環境變數，避免繞過訂閱登入或碰到其他供應端的金鑰。
- 永不使用 bypassPermissions。

實測 Claude CLI：這組參數下讀取 repo 外檔案成功、在 cwd 內寫檔成功、寫 cwd 外的檔案會立即被拒絕並列在 `permission_denials`，不會卡住。

GP run 的英文 sidecar 原本共用 translator dispatcher；translator 不再有檔案工具，所以 sidecar 改用 writer 路由。Sidecar 本來就不屬於 GP role profile，fingerprint 不受影響。

替代方案是讓所有 Claude 角色都拿檔案工具。那會讓被注入的來源有機會在 GP 工作目錄改寫 `source-tweet.md` 之類的證據檔，讓 source reviewer 對照被竄改的來源，因此不採用。

### 5. Provider preflight 以角色為單位

`requiredProviders` 必須等於各角色實際使用的供應端集合（`codex`、`claude`），不一致就失敗。解析某個角色時，只檢查該角色的供應端：Codex 查 CLI 與登入，Claude 查 CLI 登入狀態與寫手 pin 能否解析。這樣評審解析不會呼叫 Claude CLI，也不會為了每次評審多花一個 Claude CLI 啟動時間。Grok 沒有角色使用，就不需要安裝或查詢。

部署 daemon 的寫入 canary 仍在領取文章前實際跑一次 Claude 寫手；GP run 在任何文字變動前建立全部寫作與 gate dispatcher，兩條入口都在工作開始前封閉失敗。

### 6. Grok 退出 profile，但保留 provider 程式碼

Grok 不再擔任任何角色，所以從 `requiredProviders` 移除，也移除只為 Grok 寫手存在的額度政策（`grokQuota` 與 router 裡 reserve／pause／defer 分支；該政策本來就因沒有可靠 quota feed 而停用）。Grok 的 provider bridge 與評審 executor 保留，將來若要讓 Grok 擔任評審，只需改 config；寫作角色則會被第 1 點的檢查擋下。

### 7. Codex 寫手退役

刪除 Codex 寫手 executor 與 Codex 寫入 canary。`.codex/agents/tribunal-writer.toml` 保留寫作契約文字（Claude 寫手的 prompt 會引用），但移除 Codex `model`／effort 綁定，並寫明只由 Claude 執行，避免 Codex session 把它當成可呼叫的寫手。

### 8. 額度

控制器維持只讀 Codex 額度。Claude 寫手遇到額度錯誤時，沿用既有「非 Codex 供應端以 unknown 暫停」的處理：丟棄候選、還原文章、標記 `QUOTA_SUSPENDED`。Go 端的 Claude provider 會把 CLI 的錯誤訊息帶進 error，讓既有的額度分類認得出來。

## Risks / Trade-offs

- [風險] 背景改寫全部改用 Claude，VM 上的 Claude 訂閱額度會被 Tribunal 與 GP pipeline 一起消耗，而控制器看不到 Claude 額度 → 額度錯誤以 unknown 暫停單篇文章並保留可觀測紀錄；runbook 寫明控制器只調節 Codex，必要時用 `--workers` 與停機控制用量。
- [風險] VM 的 Claude CLI 版本太舊，不支援 `--tools`、`--json-schema` 或 `auth status --json` → 部署 daemon 的寫入 canary 與 router preflight 會在領取文章前失敗；runbook 列為部署前置條件。
- [風險] VM 用環境變數 token 登入時，暫態 systemd service 不會繼承 → 規定以 Claude CLI 自己的登入狀態（`~/.claude`）驗證，canary 會直接暴露這個問題。
- [取捨] GP translator 與 corrector 共用同一個 model → 以獨立 Codex gate 核准 findings、patch boundary 驗證與 fail-closed routing 維持獨立性（見 Decision 3）。
- [取捨] GP natural-zh vibe gate 仍是 Codex，會評 Claude 的譯文 → 這正是寫作與 gate 分離的要求；owner 只要求寫作角色換成 Claude。
- [風險] 刪除 Codex／Grok 寫手後，本機若仍設 `GP_WRITER_MODE=codex` 或 `GP_WRITER_PROVIDER=codex` 會直接失敗 → 錯誤訊息指出改用 Claude 的設定。

## Migration Plan

1. Merge 後在 Tribunal VM 以 tribunal 使用者安裝或更新 Claude Code CLI，執行 `claude auth login`，確認 `claude auth status --json` 回報已登入。
2. 重新安裝受版控的 `tribunal-loop.service`，`systemctl --user daemon-reload` 後重啟；doctor 的 service contract 會比對檔案內容。
3. 跑 `bash scripts/cc-tribunal-loop-wrapper.sh --doctor --live-probe`，確認 Claude 寫入 canary 通過。
4. Grok CLI 可以保留或移除，runtime 不再依賴它。

回退：revert 這個 change 的 commits 並重新安裝 unit，即可回到 Grok／Codex 寫手。
