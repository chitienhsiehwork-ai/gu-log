## ADDED Requirements

### Requirement: 每個 tribunal 角色 SHALL 有明確的 model 配置

Tribunal pipeline SHALL 為每個角色指定固定的 model ID，不依賴 default 或環境變數。

配置表：
- Writer / Translator: `claude-opus-4-6[1m]`
- Vibe Scorer: `claude-opus-4-6[1m]`
- Librarian: `claude-opus-4-6[1m]`
- Fresh Eyes: `claude-opus-4-6[1m]`
- Fact Checker: `claude-opus-4-7`

#### Scenario: Vibe scorer 使用 4.6

- **WHEN** tribunal 執行 vibe scoring stage
- **THEN** 呼叫 Claude API 時 SHALL 使用 model ID `claude-opus-4-6[1m]`
- **AND** scores frontmatter 的 `model` 欄位 SHALL 記錄 `claude-opus-4-6`

#### Scenario: Fact checker 使用 4.7

- **WHEN** tribunal 執行 fact checking stage
- **THEN** 呼叫 Claude API 時 SHALL 使用 model ID `claude-opus-4-7`
- **AND** scores frontmatter 的 `model` 欄位 SHALL 記錄 `claude-opus-4-7`

#### Scenario: CLI flag 不能覆蓋 pipeline model

- **WHEN** 使用者以 `claude --model claude-opus-4-7` 啟動 tribunal
- **THEN** pipeline 內部的 model 選擇 SHALL 不受 CLI flag 影響
- **AND** 各角色 SHALL 仍使用配置表指定的 model

---

### Requirement: Model 配置 SHALL 在程式碼中 hard-pin

Pipeline 程式碼（shell 和 TypeScript）SHALL 在呼叫每個 judge 時明確帶入 `--model` 參數或等效的 API 設定。SHALL NOT 依賴 agent 檔 frontmatter 的 `model:` 欄位作為唯一 pinning 機制。

#### Scenario: Shell pipeline 每個 stage 帶 model 參數

- **WHEN** `tribunal-all-claude.sh` 呼叫 `claude` CLI 執行 judge
- **THEN** 命令 SHALL 包含 `--model <model-id>` 參數
- **AND** model ID SHALL 來自程式碼內的 mapping（不是環境變數）

#### Scenario: V2 pipeline 每個 stage 帶 model 設定

- **WHEN** `pipeline.ts` 發起 judge 呼叫
- **THEN** API 呼叫 SHALL 指定 model
- **AND** model SHALL 來自程式碼內的常數定義

---

### Requirement: Model 策略 SHALL 文件化

`scripts/vibe-scoring-standard.md` SHALL 包含完整的 model 配置策略說明，包含：
- 配置表（角色 → model → 理由）
- 4.7 為何不適合翻譯和 vibe 評分的證據（引用 SP-175, SP-177 案例）
- 變更 model 配置的流程（需要 A/B 測試 + 人工驗證）

#### Scenario: 新版 vibe-scoring-standard 包含 model 策略

- **WHEN** 開發者查看 `scripts/vibe-scoring-standard.md`
- **THEN** SHALL 找到 model 配置表和選擇理由
- **AND** SHALL 找到變更 model 的流程說明

---

### Requirement: Opus 4.5 A/B 測試

SHALL 完成 Opus 4.5 vs 4.6 的對比測試，決定 4.5 是否適合作為 writer 或 scorer。

測試方法：
1. 挑 3 篇文章（含 SP-177 原文）
2. 分別用 4.5 和 4.6 翻譯
3. 用 4.6 scorer 評分兩個版本
4. 人工比較可讀性和趣味度
5. 結論寫入 `vibe-scoring-standard.md`

#### Scenario: A/B 測試產出可比較的結果

- **WHEN** 同一篇原文分別用 4.5 和 4.6 翻譯
- **THEN** 兩個版本 SHALL 都經過 4.6 vibe scorer 評分
- **AND** 評分結果 SHALL 記錄在 `scores/` 目錄下供比較

#### Scenario: 測試結論寫入文件

- **WHEN** A/B 測試完成
- **THEN** `vibe-scoring-standard.md` SHALL 包含 4.5 vs 4.6 的結論
- **AND** 結論 SHALL 包含具體分數對比和人工觀察
