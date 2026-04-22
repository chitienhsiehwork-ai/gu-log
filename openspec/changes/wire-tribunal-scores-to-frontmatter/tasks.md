## 1. Shell Pipeline（tribunal-all-claude.sh）

- [ ] 1.1 在 `tribunal-all-claude.sh` 頂部加 judge key mapping（associative array 或 function：`vibe-scorer` → `vibe`、`fact-checker` → `factCheck`、`fresh-eyes` → `freshEyes`、`librarian` → `librarian`）
- [ ] 1.2 在 `run_stage()` 的 PASS 路徑（L327-328 附近），`write_stage_progress` 之後加入 `write_score_to_frontmatter "$post_path" "$fm_key" "$score_json"` 呼叫
- [ ] 1.3 確保 `$score_json` 包含 `date`（ISO 8601）和 `model`（model label）欄位；如果 judge output 沒帶，在呼叫前補上
- [ ] 1.4 加入不認識 stage name 的 warning log（mapping 查不到時跳過寫入、印警告）

## 2. V2 TypeScript Pipeline（pipeline.ts）

- [ ] 2.1 在 `pipeline.ts` 加入 judge key mapping constant（stage identifier → frontmatter scores key）
- [ ] 2.2 在每個 judge stage 的 pass 路徑加入 `config.io.updateFrontmatter()` 呼叫，寫入 `scores.<judgeKey>` 物件
- [ ] 2.3 確保寫入使用 deep merge（不覆蓋其他 judge 已寫入的分數），確認 `updateFrontmatter` 的 merge 行為
- [ ] 2.4 Score 物件格式：`{ 維度分數..., score: floor(avg), date: ISO string, model: label }`

## 3. 驗證

- [ ] 3.1 手動跑一篇文章的 tribunal（shell pipeline），確認 frontmatter 出現 scores
- [ ] 3.2 確認 en-* 對應檔也同步更新了 scores
- [ ] 3.3 跑 `pnpm run build` 確認 Zod schema 驗證通過
- [ ] 3.4 開 dev server 確認 AiJudgeScore badge 正確渲染
- [ ] 3.5 測試中途失敗場景：只讓 2 個 judge pass，確認 partial scores 正確渲染

## 4. 回填既有文章

- [ ] 4.1 對已有 tribunal progress 記錄但 frontmatter 缺 scores 的文章，寫一個回填 script（從 `tribunal-progress.json` / `ralph-progress.json` 讀分數 → 寫入 frontmatter）
- [ ] 4.2 跑回填 script，commit 結果
