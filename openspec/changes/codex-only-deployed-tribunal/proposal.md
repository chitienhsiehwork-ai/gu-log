## Why

clawd-vm 的 Tribunal 部署版仍把 Claude CLI／憑證當成嚴格 VibeScorer、寫手前置檢查與服務啟動的必要條件，和 owner 已明確決定的「VM 全程只用 Codex」衝突；同時額度錯誤路徑仍會呼叫卡在 Claude PTY 半段的 CodexBar 合併探測。這使新的隔離 Codex 寫手即使本身安全可用，正式 daemon 仍會在派送文章前失敗或白等。

## What Changes

- **BREAKING**：clawd-vm 部署版嚴格路由的四位評審與寫手全部改用 Codex，各角色 model 從 `.codex/agents/*.toml` 解析並如實記錄來源。
- 每次派送只解析一次不可變的 provider／model／reasoning 描述；執行參數、來源與 runner label 必須使用同一份值。
- 四位部署版 Codex 評審不再使用 `danger-full-access`，改與寫手共用無網路的 `workspace-write` 指令建構器；正式 repo 只讀，只有一次性評審工作區可寫。
- 每次部署版 Codex 呼叫另包在暫態 systemd service cgroup；`setsid()` 後代由 unit identity 回收，並與 supervisor 共用總體資源 slice。
- 雙語候選 CAS 在第一次交換前寫入耐久 journal；啟動時在 main 與 worker worktree 同步前重入復原，未知狀態一律封閉失敗。
- 正式服務與 wrapper 預設 `GP_WRITER_MODE=codex`，不再載入或驗證 Claude 憑證。
- 部署版寫手前置檢查改成有界 Codex 寫入 canary，重用正式寫手專用的 `workspace-write`、tmp 排除與無網路沙箱；失敗仍在領取文章前封閉失敗。
- 額度錯誤探測只執行限定 Codex 供應端的 CodexBar JSON 指令，不呼叫合併或 Claude 額度路徑。
- 未啟用部署版嚴格模式的 CCC／舊版相容備援保留，但不得成為 clawd-vm 正式環境成功的必要條件。
- 更新操作文件與可執行合約，明確反映只用 Codex 的供應端邊界。

## Capabilities

### New Capabilities

無。

### Modified Capabilities

- `codex-tribunal-runtime`：部署版嚴格模式從 VibeScorer=Claude／其餘=Codex，改成四位評審全用 Codex，model 與來源由各角色 Codex TOML 決定。
- `tribunal-24-7-operations`：正式寫手、啟動前置檢查、服務憑證與額度探測改成只用 Codex 的封閉失敗合約。

## Impact

影響 Tribunal provider／model 解析器、Codex 寫手沙箱與 CAS 指令、額度處理、systemd service／slice／wrapper、監看與 doctor 行為、部署 runbook、shell／Vitest 回歸，以及兩份既有 OpenSpec 能力。保留相容 helper，但 clawd-vm 部署路徑不再需要 Claude CLI、token 或額度。
