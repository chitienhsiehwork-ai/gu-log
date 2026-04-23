## ADDED Requirements

### Requirement: Daemon SHALL run continuously and respect quota floor

Tribunal daemon SHALL 在 systemd user service 下持續執行，每輪 MUST 先檢查 Claude API 剩餘 quota 後再決定是否 dispatch 文章。

#### Scenario: Quota 高於 floor 時 dispatch 文章

- **WHEN** daemon 迴圈偵測到 `min(five_hr_remaining_pct, weekly_remaining_pct) > 3`
- **THEN** daemon SHALL 選取下一篇未跑 tribunal 的 zh-tw 文章
- **AND** SHALL 立即 dispatch 給 tribunal engine
- **AND** SHALL 在跑完該篇後 cooldown 10 秒再回迴圈

#### Scenario: Quota 觸底時進入 STOP 狀態

- **WHEN** daemon 偵測到 `min(five_hr_remaining_pct, weekly_remaining_pct) ≤ 3`
- **THEN** daemon SHALL 停止 dispatch 新文章
- **AND** SHALL 每 30 分鐘重新檢查 quota
- **AND** SHALL 在 quota 回升到 ≥ 10 時才恢復 dispatch（hysteresis）

#### Scenario: Quota 無法讀取時保守等待

- **WHEN** `usage-monitor.sh` 回傳非法 JSON 或不存在
- **THEN** daemon SHALL 不 dispatch 文章
- **AND** SHALL 休眠 10 分鐘後重試
- **AND** SHALL 在 log 記錄 quota 讀取失敗的原因

---

### Requirement: Daemon SHALL select unprocessed zh-tw posts newest first

Daemon SHALL 從 `src/content/posts/` 的 `.mdx` 檔案中選取未處理的文章，並 MUST 以檔名反向排序（newest-first）。

#### Scenario: 只選 zh-tw、非 deprecated、未 PASS 的文章

- **WHEN** daemon 建立待處理文章清單
- **THEN** 清單 SHALL 排除檔名以 `en-` 開頭的英文版
- **AND** SHALL 排除 frontmatter `status: "deprecated"` 的文章
- **AND** SHALL 排除 `scores/tribunal-progress.json` 中 status 為 `PASS` 或 `EXHAUSTED` 的文章
- **AND** SHALL 以檔名反向排序（newest first）

#### Scenario: 無未處理文章時進入閒置模式

- **WHEN** 待處理清單為空
- **THEN** daemon SHALL 休眠 30 分鐘
- **AND** SHALL 在下一輪重新 `git pull --rebase origin main` 後再檢查

---

### Requirement: Daemon SHALL support TS and shell tribunal engines via env var

Daemon SHALL 根據 `TRIBUNAL_ENGINE` 環境變數決定呼叫哪一套 tribunal pipeline，未設時 MUST 預設使用 TypeScript v2 pipeline。

#### Scenario: TRIBUNAL_ENGINE 未設或設為 ts 時走 TypeScript pipeline

- **WHEN** `TRIBUNAL_ENGINE` 未設或設為 `ts`
- **THEN** daemon SHALL 呼叫 `pnpm tribunal:run <post-path>`
- **AND** SHALL 以 exit code 0 視為 PASS、1 視為 FAIL、3 視為 NEEDS_REVIEW

#### Scenario: TRIBUNAL_ENGINE=shell 時 fallback 到 shell pipeline

- **WHEN** `TRIBUNAL_ENGINE=shell`
- **THEN** daemon SHALL 呼叫 `bash scripts/tribunal-all-claude.sh <filename>`
- **AND** shell pipeline SHALL 於 `scripts/tribunal-all-claude.sh` 檔頭標示 `LEGACY`

#### Scenario: Engine 啟動時 log 哪一套被選中

- **WHEN** daemon 啟動並讀取 `TRIBUNAL_ENGINE`
- **THEN** daemon SHALL 在 log 第一行記錄「Engine: ts」或「Engine: shell」
- **AND** SHALL 在每篇文章開跑前再 log 一次 engine 名稱

---

### Requirement: Daemon SHALL process articles on dedicated branches with draft PRs

Daemon SHALL NOT 直推 main。每篇文章 MUST 走獨立 feature branch + draft PR。

#### Scenario: 每篇文章開一條 tribunal 分支

- **WHEN** daemon 開始處理一篇文章
- **THEN** SHALL 從 main 切出分支 `tribunal/<YYYY-MM-DD>-<slug>`
- **AND** 若分支名已存在，SHALL 加 `-<N>` suffix 重試
- **AND** 所有 stage commits SHALL commit 到這條分支

#### Scenario: 全 PASS + 無降級的文章 auto-merge

- **WHEN** tribunal pipeline 所有 stage 回傳 PASS
- **AND** Stage 4 不為 degraded
- **THEN** daemon SHALL push 分支、`gh pr create` 建立 PR
- **AND** SHALL 把 PR 狀態從 draft 轉 ready
- **AND** SHALL 執行 `gh pr merge --auto --squash`

#### Scenario: 有 stage fail 或 Stage 4 降級的文章保 draft PR

- **WHEN** 任一 stage 回傳 FAIL
- **OR** Stage 4 回傳 degraded
- **THEN** daemon SHALL push 分支、建立 **draft** PR（不轉 ready）
- **AND** SHALL 在 PR body 包含 stage-by-stage 結果摘要
- **AND** SHALL 繼續處理下一篇文章（不 block daemon）

#### Scenario: PR 建立失敗不應 block daemon

- **WHEN** `gh pr create` 失敗（如 GitHub API 錯誤、缺 token）
- **THEN** daemon SHALL 記錄錯誤到 log
- **AND** SHALL 保留分支在本地跟 remote
- **AND** SHALL 繼續處理下一篇文章（operator 可事後手動補 PR）

---

### Requirement: Daemon SHALL be idempotent across crashes and restarts

Daemon SHALL 以 `scores/tribunal-progress.json` 作為 source of truth；重啟後 MUST 不導致同一篇文章被重跑或被漏掉。

#### Scenario: 重啟後從 progress file 恢復

- **WHEN** daemon 啟動（首次或 systemd restart 後）
- **THEN** SHALL 讀取 `scores/tribunal-progress.json` 作為 source of truth
- **AND** 進行中（status `running`）的文章 SHALL 根據各 stage 的 progress 決定是否續跑或重新開始

#### Scenario: 單篇文章崩潰不影響下一篇

- **WHEN** tribunal pipeline 對某篇文章拋錯 exit（非 PASS / FAIL / NEEDS_REVIEW）
- **THEN** daemon SHALL 記錄錯誤到 log
- **AND** SHALL 不更新該篇在 `tribunal-progress.json` 的 status（保留 `pending` 供重試）
- **AND** SHALL 繼續迴圈到下一篇

#### Scenario: 同一時間只能一個 daemon 跑

- **WHEN** systemd 嘗試啟動第二個 `tribunal-loop.service` 實例
- **THEN** systemd unit 的 `Type=simple` 與 `WantedBy=default.target` SHALL 確保只有一個實例執行
- **AND** 若手動跑 `tribunal-quota-loop.sh` 時已有 systemd 實例在跑，手動版 SHALL 失敗或明確警告

---

### Requirement: Daemon SHALL emit alerts on critical failures

Daemon SHALL 在進入異常狀態時透過 webhook（`TRIBUNAL_ALERT_WEBHOOK`）或 local log 通知 operator；MUST 至少涵蓋三種情境：crash、long-stop、consecutive-fail。

#### Scenario: Daemon crash 觸發 systemd OnFailure

- **WHEN** daemon 以非 0 exit code 結束
- **THEN** systemd SHALL 依 `OnFailure=tribunal-alert@%n.service` 觸發 alert unit
- **AND** alert unit SHALL 呼叫 `scripts/tribunal-alert.sh crash <daemon-name> "<journal-tail>"`

#### Scenario: STOP 持續超過 12 小時告警

- **WHEN** daemon 處於 STOP 狀態超過 12 小時（quota 一直沒回來）
- **THEN** daemon SHALL 呼叫 `tribunal-alert.sh warning long-stop "quota stuck at <X>%"`
- **AND** 同條件告警 SHALL 有 1 小時冷卻避免 spam

#### Scenario: 連續 3 篇文章 fail 告警

- **WHEN** 最近 3 篇連續處理的文章都是 FAIL 或 NEEDS_REVIEW
- **THEN** daemon SHALL 呼叫 `tribunal-alert.sh error consecutive-fail "<article slugs>"`
- **AND** 告警觸發後 SHALL 重置計數器

#### Scenario: 無 webhook 設定時告警寫到 log

- **WHEN** `TRIBUNAL_ALERT_WEBHOOK` 未設
- **THEN** `tribunal-alert.sh` SHALL 把告警內容 append 到 `.score-loop/logs/alerts-<YYYY-MM-DD>.log`
- **AND** SHALL 不 block daemon loop

---

### Requirement: Daemon SHALL run without ~/clawd/scripts/ dependency

Daemon SHALL 優先使用 `$HOME/clawd/scripts/usage-monitor.sh`，但當該路徑不存在時 MUST fallback 到 repo 內 vendored 版 `scripts/usage-monitor.sh`。

#### Scenario: 優先讀 ~/clawd/scripts/ 版

- **WHEN** daemon 啟動並準備 quota helper
- **THEN** SHALL 優先檢查 `$HOME/clawd/scripts/usage-monitor.sh` 是否可執行
- **AND** 若存在 SHALL 使用該份，並在 log 記錄路徑 + mtime

#### Scenario: 外部版不存在時 fallback 到 repo 內版

- **WHEN** `$HOME/clawd/scripts/usage-monitor.sh` 不存在或不可執行
- **THEN** SHALL fallback 到 `scripts/usage-monitor.sh`（repo 內 vendored 版）
- **AND** 若 repo 內版也不存在 SHALL 以 quota 偵測失敗處理（休 10 分鐘重試）

---

### Requirement: Daemon SHALL emit minimal daily metrics

Daemon SHALL 每日寫一份 `.score-loop/metrics/daily-<YYYY-MM-DD>.json`，MUST 至少涵蓋 throughput（articlesProcessed / Passed / Failed）、stage 失敗分佈、quota 燃燒區間、STOP 累計時間。

#### Scenario: 每篇文章跑完 append JSONL

- **WHEN** tribunal pipeline 回傳結果（任何結果）
- **THEN** daemon SHALL append 一行到 `.score-loop/metrics/daily-<YYYY-MM-DD>.jsonl`
- **AND** 該行 SHALL 至少包含：文章 slug、結果（PASS/FAIL/NEEDS_REVIEW）、每 stage 的 loop 數、處理時間、quota 前後 %

#### Scenario: 每日午夜 / daemon 啟動時 aggregate 成 daily.json

- **WHEN** daemon 啟動
- **OR** 跨 TZ=Asia/Taipei 午夜
- **THEN** SHALL 把前一天的 JSONL aggregate 成 `.score-loop/metrics/daily-<YYYY-MM-DD>.json`
- **AND** daily.json SHALL 包含：articlesProcessed / articlesPassed / articlesFailed / stageFailures（按 stage 細分）/ quotaMinPct / quotaMaxPct / stopMinutes

#### Scenario: JSONL 不追版本、daily.json 追版本

- **WHEN** daemon 寫 metrics
- **THEN** `.gitignore` SHALL 排除 `.score-loop/metrics/*.jsonl`（raw event log）
- **AND** SHALL 追 `.score-loop/metrics/*.json`（每日 summary，小、有價值）

---

### Requirement: Daemon SHALL support dry-run mode

Daemon SHALL 提供 `--dry-run` flag；啟用時 MUST 僅列出目前狀態（quota、engine、待處理文章清單），MUST NOT dispatch 文章、改檔案或 commit。

#### Scenario: --dry-run 列清單但不跑

- **WHEN** operator 執行 `bash scripts/tribunal-quota-loop.sh --dry-run`
- **THEN** daemon SHALL 列出當前未處理文章清單（按 newest-first 順序）
- **AND** SHALL 印出當前 quota %、engine（TS/shell）、下一篇將要處理的檔名
- **AND** SHALL 不 dispatch 任何文章、不改任何檔案、不 git commit
- **AND** SHALL 以 exit 0 結束
