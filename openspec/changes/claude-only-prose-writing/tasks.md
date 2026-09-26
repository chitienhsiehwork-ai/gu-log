# Tasks

## 1. 規範與決策紀錄

- [x] 1.1 建立本 change 的 proposal、design、tasks 與 spec delta，確認 `openspec validate claude-only-prose-writing --strict` 通過
- [x] 1.2 在 `docs/shroomdog-editorial-feedback.md` 最上方記錄 2026-09-26 的 owner 決定（原始回饋、情境、修法、可重用的 lesson，含「角色是 Mogu、模型是 Claude」的區分），確認格式與既有條目一致

## 2. gp-pipeline 呼叫 Claude 模型的方式

- [x] 2.1 Claude provider 支援 structured output、最小權限模式，並把 CLI 錯誤訊息帶進 error；以 `go test ./internal/llm` 的 Claude provider 測試驗證參數、structured output 缺漏與錯誤訊息
- [x] 2.2 本機寫作 chain 只使用 pin 住的 Claude 模型：拒絕 `GP_WRITER_PROVIDER=codex`、缺 `claude` 時不退 Codex、離線預設來源標籤改為 Claude pin；以寫作 chain 測試驗證

## 3. VM runtime profile

- [x] 3.1 `config/llm-pipeline.json` 的寫作步驟改用 Claude 模型且不宣告 model／effort，`requiredProviders` 改為實際使用的供應端，移除 Grok 額度區塊；以 router 與 Go profile 測試驗證（`requiredProviders` 部分已由 7.5 取代：整個欄位刪除，供應端改由各步驟推導）
- [x] 3.2 Router 強制寫作步驟使用 Claude、從 tribunal-writer frontmatter 解析 model、以步驟為單位做供應端 preflight 並檢查 `requiredProviders` 一致性、移除 Grok 額度分支；Grok provider bridge 只檢查 Grok，沒有步驟使用 Grok 時拒絕執行；以 `bash scripts/tests/test-tribunal-model-router.sh`、`test-tribunal-vm-routing.sh` 與 Go 的 Grok bridge 測試驗證（`requiredProviders` 一致性與 Grok bridge 部分已由 7.5 取代：兩者都已刪除，router 改為雙向檢查寫作步驟與 Claude 的配對）
- [x] 3.3 Go routing 只讓寫作步驟使用 Claude、比對 router 回報的 model 與 `ClaudeOpusPinned`、依步驟給最小權限的 Claude provider；GP profile 改成寫作步驟與 gate 評審不共用 model；以 routing／profile 測試與 pin 漂移測試驗證（「Go routing 自己擋非 Claude 寫作步驟」已由 7.5 取代：這項判定只在 router 做，Go 只保留 pin 比對與 gate 不共用 model 的檢查）
- [x] 3.4 GP run 的英文 sidecar 改用 writer 路由、corrector 帶 bounded-patch schema、doctor 列出 `claude`；以 `go test ./...` 驗證

## 4. Tribunal 改寫

- [x] 4.1 Helpers 新增 `GP_WRITER_MODE=claude` 的受限 Claude 執行器、寫入 canary 與單一執行描述來源紀錄，`codex`／`grok` 寫手模式改為已退役錯誤並移除舊的改寫 executor；以 Tribunal 安全合約測試驗證
- [x] 4.2 隔離候選交易只接受 Claude 模型，systemd unit、wrapper、gp-pipeline wrapper 與 batch runner 改用 Claude 模型；以部署就緒與 batch provider 測試驗證
- [x] 4.3 Shell 合約測試改用 fake Claude CLI 涵蓋改寫、final-build 修復、額度暫停、背景子行程與 canary；以 runner-error-guard、deploy-readiness、codexbar controller、vm-routing 測試驗證
- [x] 4.4 `.codex/agents/tribunal-writer.toml` 移除 Codex model 綁定並寫明改寫只使用 Claude 模型；以 vitest 的 editorial contract 測試與 Tribunal 安全合約測試驗證

## 5. 文件同步

- [x] 5.1 更新 `docs/tribunal-runbook.md`、`tools/gp-pipeline/README.md`、`tools/gp-pipeline/SKILL.md` 與 playbooks，只寫 policy 與 SSOT 位置、不複製 model 版本；以 `rg` 確認已無「Grok／Codex 負責寫」的描述

## 6. 整合驗證

- [x] 6.1 跑 `go test ./...`、`pnpm exec vitest run`（CI 的 unit tests；本 repo 的 `pnpm run test` 是 Playwright）、`pnpm run lint`、`node scripts/validate-posts.mjs`、`scripts/tests/*.sh` 與 `openspec validate --strict`，把沙盒造成的失敗和 main 上的同一批失敗逐一比對

## 7. 第一輪審查修正

- [x] 7.1 Claude CLI 的額度與登入錯誤分成兩類，以目前 CLI 實際輸出的訊息當 Go 與 shell 共用的回歸樣本；額度等待只看 Claude 回報的重置時間，無法解析時採保守預設，不執行 CodexBar；以 `go test ./internal/llm` 與 `test-tribunal-shell-quota-parser.sh` 驗證
- [x] 7.2 Claude 回報 `is_error` 時一律失敗並帶出 `errors[]`（含結束碼 0、`result` 為空）；以 Claude provider 測試驗證
- [x] 7.3 Tribunal 改寫撞到 Claude 額度時還原文章、不計失敗與改寫次數，daemon 暫停派送到重置時間；登入失效時還原文章、停止領新文章並提示 `claude auth login`；quota loop 分辨 rc 75 的額度暫停與 lock collision；以 runner-error-guard 與 deploy-readiness 測試驗證
- [x] 7.4 允許改寫但寫手模式不是 `claude` 時，在第一位評審前失敗；寫手 preflight 失敗後 systemd 至少間隔 10 分鐘才重啟；以 deploy-readiness 與安全合約測試驗證
- [x] 7.5 刪除 `quotaAction`、`requiredProviders` 與 Grok 供應端，router 成為判定寫作步驟的唯一位置並雙向檢查；以 model-router、vm-routing 與 Go routing／profile 測試驗證
- [x] 7.6 暫態 systemd service 抽成共用函式並寫明各供應端的憑證規則，受限的 Claude 呼叫不載入主機 settings 與 MCP server；以 `test-tribunal-model-cli-env.sh`、安全合約測試與 Go 的環境變數交叉比對測試驗證
- [x] 7.7 JSON 寫作步驟帶 schema、缺少 `claude` 時給可行動錯誤；以 source preservation 與 dispatcher 測試驗證
- [x] 7.8 runbook、README、SKILL、playbook 與 Go 註解裡抄的政策收成一句並指回 spec 或 code，runbook 改正 Claude 登出時的行為並在部署步驟確認 Claude 已登入；proposal／design 寫明推翻 2026-07-28 的 Codex-only 部署決定與取捨
- [x] 7.9 刪除 writer broker（`tribunal_writer_exec_broker`、`scripts/writer-broker-wait.sh` 與其測試）和舊版 `cli` 寫手執行器；`subagent`、`cli` 跟 `codex`、`grok` 一樣集中由 `tribunal_writer_mode_problem` 回「已退役」錯誤，允許改寫時在第一位評審前失敗；以 safety-contract、deploy-readiness、batch provider 測試驗證

## 8. 第三輪審查修正

- [x] 8.1 錯誤分類補上 CLI 用量限制清單裡的訊息與暫時性錯誤：quota、transient 可以等待，login、config（帳號設定與 model pin）需要人處理；Go 與 shell 共用樣本；以 `go test ./internal/llm` 與 `test-tribunal-shell-quota-parser.sh` 驗證
- [x] 8.2 改寫遇到暫時性錯誤時還原、不重評、不計次並短暫暫停派送；帳號設定或 model pin 不能用時 rc 78 停止領文章；寫手失敗且沒有候選時計一次嘗試但不重評；以 deploy-readiness 與 runner-error-guard 驗證
- [x] 8.3 手動 batch runner 遇到額度暫停或 rc 78 時停下整批並說明原因，開始每篇前先看暫停檔；以 batch provider 測試驗證
- [x] 8.4 doctor 的 live probe 走跟 daemon 相同的暫態 service、有效環境與 user manager PATH；以 deploy-readiness 驗證
- [x] 8.5 Claude 寫作呼叫也清掉改變計費端點的環境變數，清單只在 helpers 維護一份，測試改讀那份清單；以 model-cli-env、deploy-readiness、model-router 與 Go 交叉比對驗證
- [x] 8.6 runbook 寫明 VM 上每個用 Claude 寫作的帳號都要各自登入，其他文件指過去；final-build 修復在交易前拒絕非 claude 模式，交易裡重複的模式檢查刪掉；補 requiredProviders、gp-pipeline wrapper 預設與 router pin 解析失敗三個測試

## 9. 最後一輪審查修正

- [x] 9.1 受限的 Claude 呼叫（部署版與 runtime profile）改成從空的環境啟動，只帶 `HOME`、`PATH`、`CLAUDE_CONFIG_DIR` 與 `TZ`；刪掉兩份環境變數黑名單與交叉比對測試（8.5 的黑名單部分由此取代）；以塞入 `ANTHROPIC_API_KEY`、`CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR` 與自訂變數的行為測試驗證（Go、model-cli-env、model-router、deploy-readiness）
- [x] 9.2 live probe 照 systemd 的方式從頭重建 daemon 的環境，包含 `tribunal.env` 的設定，不採用 operator shell 的變數；以 deploy-readiness 驗證 probe 用的是 `tribunal.env` 的 `CLAUDE_CONFIG_DIR`
