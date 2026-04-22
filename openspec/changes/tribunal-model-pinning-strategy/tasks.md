## 1. 審查現有 model 設定

- [ ] 1.1 列出 `.claude/agents/` 下所有 tribunal agent 的 `model:` 設定，確認哪些已 pin、哪些靠 default
- [ ] 1.2 檢查 `tribunal-all-claude.sh` 裡每個 stage 的 model 參數傳遞方式
- [ ] 1.3 檢查 `pipeline.ts`（v2）裡每個 judge 的 model 設定
- [ ] 1.4 檢查 `sp-pipeline` 翻譯 step 的 model 設定

## 2. Hard-pin model 到 pipeline 程式碼

- [ ] 2.1 在 `tribunal-all-claude.sh` 加入 stage → model mapping（vibe/librarian/freshEyes → `claude-opus-4-6[1m]`，factCheck → `claude-opus-4-7`）
- [ ] 2.2 確保每個 `claude` CLI 呼叫都帶 `--model` 參數
- [ ] 2.3 在 `pipeline.ts` 加入對應的 model 常數和 stage mapping
- [ ] 2.4 在 `sp-pipeline` 的翻譯 step pin 到 `claude-opus-4-6[1m]`

## 3. 文件化

- [ ] 3.1 在 `vibe-scoring-standard.md` 新增 Model 配置策略段落（配置表 + 理由 + 變更流程）
- [ ] 3.2 更新 `.claude/agents/` 下的 agent 檔，確保 `model:` 欄位跟 pipeline 一致（作為 backup pin）

## 4. Opus 4.5 A/B 測試

- [ ] 4.1 用 `claude --model claude-opus-4-5` 翻譯 SP-177 原文，存為測試版本
- [ ] 4.2 用 `claude --model claude-opus-4-6[1m]` 翻譯同一篇原文，存為對照版本
- [ ] 4.3 用 4.6 vibe scorer 評分兩個版本
- [ ] 4.4 人工比較兩版的可讀性、趣味度、中英夾雜程度
- [ ] 4.5 再挑 2 篇文章重複 4.1-4.4（確保結論不是 single sample bias）
- [ ] 4.6 結論寫入 `vibe-scoring-standard.md`

## 5. SP-177 重寫

- [ ] 5.1 用 Opus 4.6 重寫 SP-177（不是修補，是完整重寫）
- [ ] 5.2 用 4.6 tribunal 跑完整 4-judge 評分
- [ ] 5.3 確認 composite ≥ 8 且沒有任何維度 < 8
