## Context

gu-log 的 tribunal 系統有多個 AI 角色：writer（翻譯者）、vibe scorer、fact checker、librarian、fresh eyes。目前 model 選擇不一致——有些 agent 檔有 pin、有些靠 default、有些被手動覆蓋成 4.7。

已有的證據：
- `vibe-scoring-standard.md` L346 已提到要 pin scorer 到 4.6
- `.claude/agents/vibe-opus-scorer.md` 有 `model: claude-opus-4-6` 設定
- 但實際執行時（SP-177）全部 4 個 judge 都跑了 4.7 — pin 沒有生效或被覆蓋

## Goals / Non-Goals

**Goals:**
- 每個 tribunal 角色都有明確、文件化的 model 配置
- Pipeline 程式碼中 hard-pin model（不靠 default / 環境變數覆蓋）
- 完成 Opus 4.5 的 A/B 測試，決定是否採用
- 用 SP-177 重寫作為第一個測試案例

**Non-Goals:**
- 不建立自動化的 model benchmark 系統（手動 A/B 即可）
- 不改 tribunal 架構或 judge 數量
- 不處理 tribunal badge 寫入問題（#141 另外處理）

## Decisions

### 1. Model 配置表

| 角色 | Model | 理由 |
|---|---|---|
| Writer / Translator | `claude-opus-4-6[1m]` | 比喻好、語感好、中英夾雜控制佳 |
| Vibe Scorer | `claude-opus-4-6[1m]` | 4.7 已證實會放水（SP-175 校準案例） |
| Librarian | `claude-opus-4-6[1m]` | 需要語感和文化嗅覺判斷 glossary/cross-ref |
| Fresh Eyes | `claude-opus-4-6[1m]` | 需要模擬真實讀者的閱讀體驗 |
| Fact Checker | `claude-opus-4-7` | literal execution 適合事實查核和邏輯驗證 |

### 2. Pinning 機制

**選擇：在 pipeline 程式碼中 hard-code model ID，不靠 agent 檔 frontmatter**

理由：agent 檔的 `model:` 設定可能被 CLI flag 覆蓋（`claude --model xxx`），不夠可靠。Pipeline 程式碼裡直接帶 `--model` 參數最明確。

### 3. Opus 4.5 研究方案

A/B 測試計畫：
1. 挑 3 篇近期文章（SP-175, SP-177 + 一篇 4.6 已過的作為 baseline）
2. 分別用 4.5 和 4.6 翻譯同一篇原文
3. 用 4.6 scorer 評分兩個版本
4. 人工比較兩個版本的可讀性和趣味度
5. 結論寫入 `vibe-scoring-standard.md`

## Risks / Trade-offs

**[4.5 可能不夠好] Opus 4.5 在指令遵循上不如 4.6** → 先小規模測試（3 篇），不要一口氣全換。如果 4.5 指令遵循差（不遵守 WRITING_GUIDELINES），即使 vibe 好也不採用。

**[4.7 fact checker 也可能有問題] 4.7 在 fact checking 上未經驗證** → 目前 fact checker 的品質問題不在 model 上（SP-177 的 factCheck 8 分看起來合理），4.7 的 literal execution 反而是優勢。

**[Token 成本] 4.6[1m] context window 比 4.7 便宜** → 這其實是好事，用 4.6 省錢又品質好。
