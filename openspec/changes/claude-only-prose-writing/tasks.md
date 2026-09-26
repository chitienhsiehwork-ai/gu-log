# Tasks

## 1. 規範與決策紀錄

- [ ] 1.1 建立本 change 的 proposal、design、tasks 與 spec delta，確認 `openspec validate claude-only-prose-writing --strict` 通過
- [ ] 1.2 在 `docs/shroomdog-editorial-feedback.md` 最上方記錄 2026-09-26 的 owner 決定（原始回饋、情境、修法、可重用的 lesson，含「角色是 Mogu、模型是 Claude」的區分），確認格式與既有條目一致

## 2. gp-pipeline 呼叫 Claude 模型的方式

- [ ] 2.1 Claude provider 支援 structured output、最小權限模式，並把 CLI 錯誤訊息帶進 error；以 `go test ./internal/llm` 的 Claude provider 測試驗證參數、structured output 缺漏與錯誤訊息
- [ ] 2.2 本機寫作 chain 只使用 pin 住的 Claude 模型：拒絕 `GP_WRITER_PROVIDER=codex`、缺 `claude` 時不退 Codex、離線預設來源標籤改為 Claude pin；以寫作 chain 測試驗證

## 3. VM runtime profile

- [ ] 3.1 `config/llm-pipeline.json` 的寫作步驟改用 Claude 模型且不宣告 model／effort，`requiredProviders` 改為實際使用的供應端，移除 Grok 額度區塊；以 router 與 Go profile 測試驗證
- [ ] 3.2 Router 強制寫作步驟使用 Claude、從 tribunal-writer frontmatter 解析 model、以步驟為單位做供應端 preflight 並檢查 `requiredProviders` 一致性、移除 Grok 額度分支；以 `bash scripts/tests/test-tribunal-model-router.sh` 驗證
- [ ] 3.3 Go routing 只讓寫作步驟使用 Claude、比對 router 回報的 model 與 `ClaudeOpusPinned`、依步驟給最小權限的 Claude provider；GP profile 改成寫作步驟與 gate 評審不共用 model；以 routing／profile 測試與 pin 漂移測試驗證
- [ ] 3.4 GP run 的英文 sidecar 改用 writer 路由、corrector 帶 bounded-patch schema、doctor 列出 `claude`；以 `go test ./...` 驗證

## 4. Tribunal 改寫

- [ ] 4.1 Helpers 新增 `GP_WRITER_MODE=claude` 的受限 Claude 執行器、寫入 canary 與單一執行描述來源紀錄，`codex`／`grok` 寫手模式改為已退役錯誤並移除舊的改寫 executor；以 Tribunal 安全合約測試驗證
- [ ] 4.2 隔離候選交易只接受 Claude 模型，systemd unit、wrapper、gp-pipeline wrapper 與 batch runner 改用 Claude 模型；以部署就緒與 batch provider 測試驗證
- [ ] 4.3 Shell 合約測試改用 fake Claude CLI 涵蓋改寫、final-build 修復、額度暫停、背景子行程與 canary；以 runner-error-guard、deploy-readiness、codexbar controller、vm-routing 測試驗證
- [ ] 4.4 `.codex/agents/tribunal-writer.toml` 移除 Codex model 綁定並寫明改寫只使用 Claude 模型；以 `pnpm run test` 的 editorial contract 測試驗證

## 5. 文件同步

- [ ] 5.1 更新 `docs/tribunal-runbook.md`、`tools/gp-pipeline/README.md`、`tools/gp-pipeline/SKILL.md` 與 playbooks，只寫 policy 與 SSOT 位置、不複製 model 版本；以 `rg` 確認已無「Grok／Codex 負責寫」的描述

## 6. 整合驗證

- [ ] 6.1 跑 `go test ./...`、`pnpm run test`、`pnpm run lint`、`node scripts/validate-posts.mjs`、相關 `scripts/tests/*.sh` 與 `openspec validate --strict`，把沙盒造成的失敗和 main 上的同一批失敗逐一比對
