## Why

Opus 4.7 在翻譯和 vibe 評分上品質劣化：SP-175 和 SP-177 都是 4.7 翻譯，composite 都只有 7（FAIL）。核心問題有兩個：

1. **4.7 翻譯品質差**：中英夾雜嚴重、比喻不延展、ClawdNote 偏分析缺吐槽力
2. **4.7 scorer 自己放水**：SP-175 校準案例中，4.6 scorer 判 7 FAIL，4.7 scorer 判 8 PASS；SP-177 的 4.7 tribunal 自評 9 但獨立審查只有 7

同時使用者觀察到 Opus 4.5 寫出來的文章「溫暖有趣」，值得研究作為 writer/scorer 的候選。

## What Changes

- 明確定義每個 tribunal 角色的 model 配置：4.6 為主、4.7 只做 fact checker
- 在所有 pipeline 程式碼中 hard-pin model（不靠 default）
- 新增 Opus 4.5 的 A/B 測試流程，評估作為 writer 和 scorer 的表現
- 文件化 model 選擇策略到 `vibe-scoring-standard.md`

## Capabilities

### New Capabilities
- `tribunal-model-policy`: 定義 tribunal 各角色（writer, vibe scorer, fact checker, librarian, fresh eyes）的 model 選擇策略和 pinning 機制

### Modified Capabilities
（無既有 spec 需要修改）

## Impact

- `.claude/agents/vibe-opus-scorer.md` — 確認 pin 到 4.6
- `.claude/agents/` 下所有 tribunal agent — 確認 model 設定
- `scripts/tribunal-all-claude.sh` — 每個 stage 的 `--model` 參數
- `src/lib/tribunal-v2/pipeline.ts` — model 參數設定
- `tools/sp-pipeline/` — 翻譯 model 設定
- `scripts/vibe-scoring-standard.md` — 文件化 model 策略
