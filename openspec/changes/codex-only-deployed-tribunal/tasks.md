## 1. 部署版嚴格角色路由

- [x] 1.1 先補回歸測試：嚴格模式的 VibeScorer、FactChecker、Librarian、FreshEyes 都解析為 Codex 與各自 TOML model，缺 Codex／無效 TOML／`TRIBUNAL_FORCE_PROVIDER` 衝突會在領取文章前封閉失敗。
- [x] 1.2 更新可辨識角色的供應端合約與派送前驗證，讓四位嚴格評審共用 Codex 解析器，並保留非嚴格 CCC／明示覆寫相容性。
- [x] 1.3 驗證正式 runner 的 frontmatter、進度紀錄、階段 log 與 runner-error 來源都記錄每位評審實際使用的 Codex provider／model。
- [x] 1.4 將四位 Codex 評審從 `danger-full-access` 收斂到與寫手共用的無網路 `workspace-write` 指令建構器，並以回歸測試證明正式 repo 唯讀、只有一次性評審工作區可寫。
- [x] 1.5 將部署版 Codex 評審／寫手／canary 包進暫態 systemd service，watchdog 以 parent-held unit identity 停止，並以受版控的共用 slice 維持總體資源上限與 autoscaler 可見性。

## 2. 隔離 Codex 寫手與憑證邊界

- [x] 2.1 先補寫手前置檢查回歸測試：`GP_WRITER_MODE=codex` 成功、其他 mode／Codex 不可用／無效寫手 TOML／逾時／錯誤 sentinel 都在領取文章前失敗。
- [x] 2.2 讓寫手前置檢查建立私有 canary 工作區，透過正式 `tribunal-writer` Codex 執行器寫入並驗證固定 sentinel，且共用正式環境的 `workspace-write`、tmp 排除、無網路、approval 與逾時合約。
- [x] 2.3 更新受版控的 systemd unit 與 wrapper，明示部署版嚴格模式加上 `GP_WRITER_MODE=codex`，並移除 Claude token 檔、`CLAUDE_CODE_OAUTH_TOKEN` 與 Claude auth／model 前置檢查的讀取或驗證。
- [x] 2.4 更新 doctor／監看的有效執行環境與前置檢查，證明目前 service PID 通過 Codex 寫入 canary，且即時探測不會碰 Claude 憑證。
- [x] 2.5 加入失敗→改寫→重評合約，驗證部署版寫手從 `.codex/agents/tribunal-writer.toml` 取得 model、使用專用候選沙箱並記錄實際 Codex 來源。
- [x] 2.6 讓評審／寫手在派送前只解析一次執行描述，執行器與來源共用同一 provider／model／reasoning；以 TOML 中途變更回歸測試證明不會錯標。
- [x] 2.7 為雙語候選 CAS 加入 mode-0600 journal，錯誤注入驗證 journal 檔與父目錄在第一次交換前完成 fsync；加入有界且可重入的復原，並在 main 啟動與 worker 同步前接上封閉失敗。

## 3. Codex 供應端限定額度

- [x] 3.1 先補額度回歸測試，擷取 argv 並驗證控制器與 model 額度錯誤路徑都只執行精確的 `codexbar usage --provider codex --source cli --format json --pretty`，不呼叫合併或 Claude 探測。
- [x] 3.2 建立共用 CodexBar JSON 探測與 schema 驗證，支援可重現的 fixture 注入，並讓逾時、指令失敗、JSON 格式錯誤與缺少必要欄位走可觀測的封閉失敗或備援。
- [x] 3.3 將閉迴路控制器改接共用的供應端限定探測，移除部署成功對合併 `USAGE_MONITOR` 與 Claude entry parser 的依賴。
- [x] 3.4 將評審／寫手的額度錯誤等待或暫停決策改接同一 JSON 探測，保證錯誤復原不會啟動 Claude 或合併供應端。
- [x] 3.5 更新 service、wrapper 與監看的額度健康合約，只呈現 Codex 來源、短窗／長窗值與備援原因。

## 4. 操作文件與可執行合約

- [x] 4.1 更新 `docs/tribunal-runbook.md` 的啟動、部署檢查表、doctor、監看、爆發模式、疑難排解與回復，刪除部署版 Claude 憑證／額度指示並寫明只用 Codex 的邊界。
- [x] 4.2 更新 shell／Vitest 安全合約與回歸測試歸屬，加入禁止部署路徑讀 Claude token、檢查／執行 Claude binary、選 Claude 角色或執行合併額度指令的反向斷言。
- [x] 4.3 檢查非部署版 `none`／`subagent`／舊版 `cli` 與 CCC 備援仍可用，但測試證明它們不能通過部署版嚴格前置檢查。
- [x] 4.4 更新部署／監看／autoscale 可執行合約，安裝並驗證 `tribunal-runtime.slice`，證明暫態 Codex RSS 仍受總體 4G／200% 上限約束。

## 5. 驗證與 clawd-vm rollout

- [x] 5.1 跑 Tribunal 安全、部署就緒、額度控制器、額度錯誤與監看 shell suites，保留精確指令輸出作為情境→測試證據。
- [x] 5.2 跑擁有上述 shell 合約的 Vitest suites 與 repo 必要的 lint／type／build gates，確認沒有平行測試歸屬或受版控 fixture 競態回歸。
- [ ] 5.3 在 clawd-vm 同步受版控 unit，執行 `systemctl --user daemon-reload` 與 restart；確認 service 的有效 `PATH` 與子行程環境不注入或讀取 Claude 憑證，驗證啟動／doctor／派送／改寫／額度復原成功，且監看顯示五個 Codex 角色、寫手前置檢查通過與 Codex 供應端限定額度。
- [ ] 5.4 執行一篇有界的失敗→Codex 改寫→重評 smoke，確認文章領取、寫手沙箱、來源、額度錯誤處理與 journal 全程未呼叫 Claude，再記錄可回復的部署證據。
